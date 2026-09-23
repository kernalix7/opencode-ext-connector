import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import { z } from "zod"

import type { Clock, ScheduledCallback } from "../../core/clock.js"
import { InvalidArgumentError, OperationCancelledError } from "../../core/errors.js"
import { type AsyncDisposableHandle, createAsyncDisposable } from "../../core/lifecycle.js"
import type { ProcessSupervisor, SupervisedProcess } from "../../core/process.js"
import { opencodeAuthJsonPaths } from "../../opencode/auth-store.js"

const AUTH_SYNC_HELPER = "opensandbox-xai-auth-sync"
const AUTH_SYNC_PATH = "/usr/local/bin:/usr/bin:/bin"
const AuthRootSchema = z.record(z.string(), z.unknown())

type Observation =
  | { readonly kind: "ready"; readonly fingerprint: string }
  | { readonly kind: "retry" }

export type XaiAuthorityObserverOptions = {
  readonly enabled: boolean
  readonly clock: Clock
  readonly env: Readonly<Record<string, string | undefined>>
  readonly processSupervisor: ProcessSupervisor
  readonly pollMs?: number
  readonly retryMs?: number
  readonly readAuthFile?: (path: string) => Promise<string>
}

function errorCode(error: Error): unknown {
  return "code" in error ? Reflect.get(error, "code") : undefined
}

function commandEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Readonly<Record<string, string>> {
  const dataHome = env["XDG_DATA_HOME"]
  return dataHome === undefined || dataHome.length === 0 || !isAbsolute(dataHome)
    ? Object.freeze({ HOME: home, PATH: AUTH_SYNC_PATH })
    : Object.freeze({ HOME: home, PATH: AUTH_SYNC_PATH, XDG_DATA_HOME: dataHome })
}

class XaiAuthorityInvariantError extends Error {
  public override readonly name = "XaiAuthorityInvariantError"

  public constructor() {
    super("unexpected xAI authority state")
  }
}

function assertNeverAuthorityState(_state: never): never {
  throw new XaiAuthorityInvariantError()
}

export function createXaiAuthorityObserver(
  options: XaiAuthorityObserverOptions,
): AsyncDisposableHandle {
  const pollMs = options.pollMs ?? 1_000
  const retryMs = options.retryMs ?? 5_000
  if (!Number.isSafeInteger(pollMs) || pollMs <= 0) throw new InvalidArgumentError("pollMs")
  if (!Number.isSafeInteger(retryMs) || retryMs <= 0) throw new InvalidArgumentError("retryMs")
  if (!options.enabled) return createAsyncDisposable(() => undefined)

  const home = options.env["HOME"]
  if (home === undefined || home.length === 0 || !isAbsolute(home)) {
    return createAsyncDisposable(() => undefined)
  }
  const dataHome = options.env["XDG_DATA_HOME"]
  if (dataHome !== undefined && dataHome.length > 0 && !isAbsolute(dataHome)) {
    return createAsyncDisposable(() => undefined)
  }
  const [authPath] = opencodeAuthJsonPaths(options.env)
  if (authPath === undefined || !isAbsolute(authPath)) return createAsyncDisposable(() => undefined)
  const helper = join(home, ".local", "bin", AUTH_SYNC_HELPER)
  const environment = commandEnvironment(options.env, home)
  const loadAuth = options.readAuthFile ?? ((path: string) => readFile(path, "utf8"))
  const controller = new AbortController()
  let scheduled: ScheduledCallback | undefined
  let activeProcess: SupervisedProcess | undefined
  let activeEvaluation: Promise<void> | undefined
  let synchronizedFingerprint: string | undefined
  let disposalStarted = false

  const arm = (delayMs: number): void => {
    if (disposalStarted) return
    scheduled?.cancel()
    scheduled = options.clock.schedule(delayMs, () => {
      scheduled = undefined
      startEvaluation()
    })
  }

  const observe = async (): Promise<Observation> => {
    let raw: string
    try {
      raw = await loadAuth(authPath)
    } catch (error: unknown) {
      if (error instanceof Error && errorCode(error) === "ENOENT") {
        return { kind: "ready", fingerprint: "null" }
      }
      if (error instanceof Error) return { kind: "retry" }
      throw error
    }
    try {
      const parsedJson: unknown = JSON.parse(raw)
      const root = AuthRootSchema.safeParse(parsedJson)
      return root.success
        ? { kind: "ready", fingerprint: JSON.stringify(root.data["xai"] ?? null) }
        : { kind: "retry" }
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return { kind: "retry" }
      throw error
    }
  }

  const invoke = async (): Promise<boolean> => {
    const process = await options.processSupervisor.start(
      { executable: helper, arguments: [], cwd: null, environment },
      controller.signal,
    )
    activeProcess = process
    try {
      const exit = await process.wait(controller.signal)
      switch (exit.kind) {
        case "code":
          return exit.code === 0
        case "signal":
          return false
        default:
          return assertNeverAuthorityState(exit)
      }
    } finally {
      activeProcess = undefined
      await process.dispose()
    }
  }

  const evaluate = async (): Promise<void> => {
    const observation = await observe()
    if (disposalStarted) return
    switch (observation.kind) {
      case "retry":
        arm(retryMs)
        return
      case "ready":
        if (observation.fingerprint === synchronizedFingerprint) {
          arm(pollMs)
          return
        }
        if (await invoke()) synchronizedFingerprint = observation.fingerprint
        if (!disposalStarted) {
          arm(observation.fingerprint === synchronizedFingerprint ? pollMs : retryMs)
        }
        return
      default:
        return assertNeverAuthorityState(observation)
    }
  }

  const startEvaluation = (): void => {
    if (disposalStarted || activeEvaluation !== undefined) return
    const operation = evaluate().catch((error: unknown) => {
      if (error instanceof OperationCancelledError && disposalStarted) return
      if (error instanceof Error) {
        arm(retryMs)
        return
      }
      throw error
    })
    activeEvaluation = operation
    void operation.then(
      () => {
        if (activeEvaluation === operation) activeEvaluation = undefined
      },
      () => {
        if (activeEvaluation === operation) activeEvaluation = undefined
      },
    )
  }

  const disposal = createAsyncDisposable(async () => {
    disposalStarted = true
    scheduled?.cancel()
    scheduled = undefined
    controller.abort()
    await activeProcess?.terminate()
    await activeEvaluation
  })
  startEvaluation()
  return { dispose: disposal.dispose, [Symbol.asyncDispose]: disposal[Symbol.asyncDispose] }
}
