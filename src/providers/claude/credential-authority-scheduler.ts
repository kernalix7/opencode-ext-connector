import { mkdir } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import type { Clock, ScheduledCallback } from "../../core/clock.js"
import {
  InvalidArgumentError,
  OperationCancelledError,
  ProcessSupervisorError,
} from "../../core/errors.js"
import { type AsyncDisposableHandle, createAsyncDisposable } from "../../core/lifecycle.js"
import type { ConnectorLogger } from "../../core/logger.js"
import type { ProcessExit, ProcessSupervisor, SupervisedProcess } from "../../core/process.js"
import { readClaudeCredentials } from "./auth.js"
import type { ClaudeCredentials } from "./credentials.js"

const AUTHORITY_DIRECTORY = "claude-credential-authority"
const LOCK_FILE = "authority.lock"
const LOCK_CONFLICT_EXIT_CODE = 75
const MAXIMUM_DELAY_MS = 2_147_483_647
const AUTHORITY_PROMPT = "Reply OK without using tools."

export type ClaudeCredentialReader = (
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
) => Promise<ClaudeCredentials | null>

export type ClaudeCredentialAuthorityEnvironment = Readonly<Record<string, string | undefined>> & {
  readonly HOME?: string
  readonly XDG_STATE_HOME?: string
}

export type ClaudeCredentialAuthoritySchedulerOptions = {
  readonly enabled: boolean
  readonly platform?: string
  readonly clock: Clock
  readonly leadMs: number
  readonly retryMs: number
  readonly env: ClaudeCredentialAuthorityEnvironment
  readonly processSupervisor: ProcessSupervisor
  readonly logger: ConnectorLogger
  readonly readCredentials?: ClaudeCredentialReader
  readonly ensureStateDirectory?: (path: string) => Promise<void>
}

function authorityStateDirectory(env: ClaudeCredentialAuthorityEnvironment): string | null {
  const configuredState = env.XDG_STATE_HOME
  if (configuredState !== undefined && configuredState.length > 0 && isAbsolute(configuredState)) {
    return join(configuredState, "opencode-ext-connector", AUTHORITY_DIRECTORY)
  }
  const home = env.HOME
  if (home === undefined || home.length === 0 || !isAbsolute(home)) return null
  return join(home, ".local", "state", "opencode-ext-connector", AUTHORITY_DIRECTORY)
}

async function createStateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
}

function assertNeverProcessExit(exit: never): never {
  throw new InvalidArgumentError("processExit", exit)
}

export function createClaudeCredentialAuthorityScheduler(
  options: ClaudeCredentialAuthoritySchedulerOptions,
): AsyncDisposableHandle {
  if (!Number.isSafeInteger(options.leadMs) || options.leadMs < 0) {
    throw new InvalidArgumentError("leadMs")
  }
  if (!Number.isSafeInteger(options.retryMs) || options.retryMs <= 0) {
    throw new InvalidArgumentError("retryMs")
  }
  if (!options.enabled || (options.platform ?? process.platform) !== "linux") {
    return createAsyncDisposable(() => undefined)
  }

  const controller = new AbortController()
  const readCredentials = options.readCredentials ?? readClaudeCredentials
  const ensureStateDirectory = options.ensureStateDirectory ?? createStateDirectory
  const stateDirectory = authorityStateDirectory(options.env)
  let scheduled: ScheduledCallback | undefined
  let activeProcess: SupervisedProcess | undefined
  let activeEvaluation: Promise<void> | undefined
  let disposalStarted = false

  const arm = (delayMs: number): void => {
    if (disposalStarted) return
    scheduled?.cancel()
    scheduled = options.clock.schedule(
      Math.min(MAXIMUM_DELAY_MS, Math.max(0, Math.trunc(delayMs))),
      () => {
        scheduled = undefined
        startEvaluation(true)
      },
    )
  }

  const runAuthority = async (): Promise<ProcessExit | null> => {
    if (stateDirectory === null) return null
    await ensureStateDirectory(stateDirectory)
    const process = await options.processSupervisor.start(
      {
        executable: "flock",
        arguments: [
          "--exclusive",
          "--nonblock",
          "--conflict-exit-code",
          String(LOCK_CONFLICT_EXIT_CODE),
          "--no-fork",
          "--",
          join(stateDirectory, LOCK_FILE),
          "claude",
          "--restricted",
          "-p",
          AUTHORITY_PROMPT,
          "--permission-prompts",
          "none",
          "--max-turns",
          "1",
          "--output-format",
          "json",
        ],
        cwd: stateDirectory,
      },
      controller.signal,
    )
    activeProcess = process
    try {
      return await process.wait(controller.signal)
    } finally {
      activeProcess = undefined
      await process.dispose()
    }
  }

  const evaluate = async (canInvoke: boolean): Promise<void> => {
    const credentials = await readCredentials(options.env, controller.signal)
    if (disposalStarted) return
    const expiresAtMs = credentials?.expiresAtMs ?? null
    if (expiresAtMs === null) {
      arm(options.retryMs)
      return
    }
    const untilLeadMs = expiresAtMs - options.leadMs - options.clock.nowMs()
    if (untilLeadMs > 0) {
      arm(untilLeadMs)
      return
    }
    if (!canInvoke) {
      arm(options.retryMs)
      return
    }
    const exit = await runAuthority()
    if (disposalStarted) return
    if (exit === null) {
      options.logger.log("warn", "claude.credential-authority.state-unavailable", {})
      arm(options.retryMs)
      return
    }
    switch (exit.kind) {
      case "signal":
        options.logger.log("warn", "claude.credential-authority.signal-exit", {
          signal: exit.signal,
        })
        arm(options.retryMs)
        return
      case "code":
        if (exit.code === LOCK_CONFLICT_EXIT_CODE) {
          arm(options.retryMs)
          return
        }
        if (exit.code !== 0) {
          options.logger.log("warn", "claude.credential-authority.nonzero-exit", {
            exitCode: exit.code,
          })
          arm(options.retryMs)
          return
        }
        await evaluate(false)
        return
      default:
        return assertNeverProcessExit(exit)
    }
  }

  const startEvaluation = (canInvoke: boolean): void => {
    if (disposalStarted || activeEvaluation !== undefined) return
    const operation = evaluate(canInvoke).catch((error: unknown) => {
      if (error instanceof OperationCancelledError && disposalStarted) return
      if (error instanceof ProcessSupervisorError) {
        options.logger.log("warn", "claude.credential-authority.process-failed", {})
        arm(options.retryMs)
        return
      }
      if (error instanceof Error) {
        options.logger.log("warn", "claude.credential-authority.evaluation-failed", {})
        arm(options.retryMs)
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
  startEvaluation(true)
  return {
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
