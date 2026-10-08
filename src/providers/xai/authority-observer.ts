import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import { z } from "zod"

import type { Clock, ScheduledCallback } from "../../core/clock.js"
import { InvalidArgumentError, OperationCancelledError } from "../../core/errors.js"
import { type AsyncDisposableHandle, createAsyncDisposable } from "../../core/lifecycle.js"
import type { ProcessSupervisor, SupervisedProcess } from "../../core/process.js"
import { opencodeAuthJsonPaths } from "../../opencode/auth-store.js"

const AUTH_SYNC_PATH = "/usr/local/bin:/usr/bin:/bin"
const authRootSchema = z.record(z.string(), z.unknown())

export type XaiAuthorityObservation =
  | { readonly kind: "ready"; readonly fingerprint: string }
  | { readonly kind: "retry" }

export type Observation = XaiAuthorityObservation

export type XaiAuthorityObserverOptions = {
  readonly enabled: boolean
  readonly clock: Clock
  readonly env: Readonly<Record<string, string | undefined>>
  readonly processSupervisor: ProcessSupervisor
  readonly pollMs?: number
  readonly retryMs?: number
  readonly readAuthFile?: (path: string) => Promise<string>
  readonly observeSource?: () => Promise<XaiAuthorityObservation>
}

class XaiAuthorityInvariantError extends Error {
  public override readonly name = "XaiAuthorityInvariantError"
  public constructor() {
    super("unexpected xAI authority state")
  }
}

function assertNever(_state: never): never {
  throw new XaiAuthorityInvariantError()
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && Reflect.get(error, "code") === "ENOENT"
}

function createFileObservation(
  authPath: string,
  loadAuth: (path: string) => Promise<string>,
): () => Promise<Observation> {
  return async () => {
    let raw: string
    try {
      raw = await loadAuth(authPath)
    } catch (error: unknown) {
      if (isMissingFile(error)) raw = "{}"
      else if (error instanceof Error) return { kind: "retry" }
      else throw error
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      const root = authRootSchema.safeParse(parsed)
      if (!root.success) return { kind: "retry" }
      const bytes = JSON.stringify(root.data["xai"] ?? null)
      return { kind: "ready", fingerprint: createHash("sha256").update(bytes).digest("hex") }
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return { kind: "retry" }
      throw error
    }
  }
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
  const dataHome = options.env["XDG_DATA_HOME"]
  if (
    home === undefined ||
    !isAbsolute(home) ||
    (dataHome !== undefined && dataHome.length > 0 && !isAbsolute(dataHome))
  ) {
    return createAsyncDisposable(() => undefined)
  }
  const [authPath] = opencodeAuthJsonPaths(options.env)
  if (options.observeSource === undefined && (authPath === undefined || !isAbsolute(authPath))) {
    return createAsyncDisposable(() => undefined)
  }
  const observe =
    options.observeSource ??
    createFileObservation(
      authPath ?? "",
      options.readAuthFile ?? ((path) => readFile(path, "utf8")),
    )
  const environment = Object.freeze({
    HOME: home,
    PATH: AUTH_SYNC_PATH,
    ...(dataHome ? { XDG_DATA_HOME: dataHome } : {}),
  })
  const command = {
    executable: join(home, ".local", "bin", "opensandbox-xai-auth-sync"),
    arguments: [],
    cwd: null,
    environment,
  }
  const controller = new AbortController()
  let scheduled: ScheduledCallback | undefined
  let activeProcess: SupervisedProcess | undefined
  let activeEvaluation: Promise<void> | undefined
  let synchronizedFingerprint: string | undefined
  let disposalStarted = false
  const failures: unknown[] = []

  const arm = (delayMs: number): void => {
    if (disposalStarted || failures.length > 0) return
    scheduled?.cancel()
    scheduled = options.clock.schedule(delayMs, () => {
      scheduled = undefined
      startEvaluation()
    })
  }

  const invoke = async (): Promise<boolean> => {
    const process = await options.processSupervisor.start(command, controller.signal)
    activeProcess = process
    try {
      if (disposalStarted) {
        await process.terminate()
        return false
      }
      const exit = await process.wait(controller.signal)
      switch (exit.kind) {
        case "code":
          return exit.code === 0
        case "signal":
          return false
        default:
          return assertNever(exit)
      }
    } finally {
      try {
        await process.dispose()
      } catch (error: unknown) {
        failures.push(error)
      } finally {
        activeProcess = undefined
      }
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
        if (!disposalStarted)
          arm(observation.fingerprint === synchronizedFingerprint ? pollMs : retryMs)
        return
      default:
        return assertNever(observation)
    }
  }

  const startEvaluation = (): void => {
    if (disposalStarted || activeEvaluation !== undefined || failures.length > 0) return
    const operation = evaluate().catch((error: unknown) => {
      if (error instanceof OperationCancelledError && disposalStarted) return
      if (error instanceof Error && !disposalStarted) {
        arm(retryMs)
        return
      }
      failures.push(error)
    })
    activeEvaluation = operation
    void operation.then(() => {
      if (activeEvaluation === operation) activeEvaluation = undefined
    })
  }

  const disposal = createAsyncDisposable(async () => {
    const timer = scheduled
    const process = activeProcess
    scheduled = undefined
    const termination = await Promise.allSettled([
      Promise.resolve().then(() => timer?.cancel()),
      Promise.resolve().then(() => controller.abort()),
      Promise.resolve().then(() => process?.terminate()),
      activeEvaluation,
    ])
    for (const result of termination) {
      switch (result.status) {
        case "fulfilled":
          break
        case "rejected":
          failures.push(result.reason)
          break
        default:
          assertNever(result)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "xAI authority disposal failed")
  })
  const dispose = (): Promise<void> => {
    disposalStarted = true
    return disposal.dispose()
  }
  startEvaluation()
  return { dispose, [Symbol.asyncDispose]: dispose }
}
