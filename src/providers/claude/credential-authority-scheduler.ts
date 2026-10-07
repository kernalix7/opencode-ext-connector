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
import type { ProcessSupervisor, SupervisedProcess } from "../../core/process.js"
import { readClaudeCredentials } from "./auth.js"
import type { ClaudeCredentials } from "./credentials.js"

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
function stateDirectory(env: ClaudeCredentialAuthorityEnvironment): string | null {
  const base =
    env.XDG_STATE_HOME && isAbsolute(env.XDG_STATE_HOME)
      ? env.XDG_STATE_HOME
      : env.HOME && isAbsolute(env.HOME)
        ? join(env.HOME, ".local", "state")
        : null
  return base === null ? null : join(base, "opencode-ext-connector", "claude-credential-authority")
}
export function createClaudeCredentialAuthorityScheduler(
  options: ClaudeCredentialAuthoritySchedulerOptions,
): AsyncDisposableHandle {
  if (!Number.isSafeInteger(options.leadMs) || options.leadMs < 0)
    throw new InvalidArgumentError("leadMs")
  if (!Number.isSafeInteger(options.retryMs) || options.retryMs <= 0)
    throw new InvalidArgumentError("retryMs")
  if (!options.enabled || (options.platform ?? process.platform) !== "linux")
    return createAsyncDisposable(() => undefined)
  const directory = stateDirectory(options.env)
  const controller = new AbortController()
  let scheduled: ScheduledCallback | undefined
  let activeProcess: SupervisedProcess | undefined
  let evaluation: Promise<void> | undefined
  let disposed = false
  const arm = (delay: number): void => {
    if (disposed) return
    scheduled?.cancel()
    scheduled = options.clock.schedule(
      Math.min(2_147_483_647, Math.max(0, Math.trunc(delay))),
      () => {
        scheduled = undefined
        start(true)
      },
    )
  }
  const evaluate = async (canInvoke: boolean): Promise<void> => {
    const credentials = await (options.readCredentials ?? readClaudeCredentials)(
      options.env,
      controller.signal,
    )
    if (disposed) return
    if (credentials?.expiresAtMs === null || credentials === null) {
      arm(options.retryMs)
      return
    }
    const untilLead = credentials.expiresAtMs - options.leadMs - options.clock.nowMs()
    if (untilLead > 0) {
      arm(untilLead)
      return
    }
    if (!canInvoke) {
      arm(options.retryMs)
      return
    }
    if (directory === null) {
      options.logger.log("warn", "claude.credential-authority.state-unavailable", {})
      arm(options.retryMs)
      return
    }
    await (
      options.ensureStateDirectory ??
      ((path) => mkdir(path, { recursive: true, mode: 0o700 }).then(() => undefined))
    )(directory)
    if (disposed) return
    const environment: Record<string, string> = {}
    for (const [key, value] of Object.entries(options.env)) {
      if (key !== "ANTHROPIC_API_KEY" && value !== undefined) environment[key] = value
    }
    const process = await options.processSupervisor.start(
      {
        executable: "flock",
        cwd: directory,
        environment,
        arguments: [
          "--exclusive",
          "--nonblock",
          "--conflict-exit-code",
          "75",
          "--no-fork",
          "--",
          join(directory, "authority.lock"),
          "claude",
          "--restricted",
          "-p",
          "Reply OK without using tools.",
          "--permission-prompts",
          "none",
          "--max-turns",
          "1",
          "--output-format",
          "json",
        ],
      },
      controller.signal,
    )
    activeProcess = process
    try {
      const exit = await process.wait(controller.signal)
      if (disposed) return
      switch (exit.kind) {
        case "signal":
          options.logger.log("warn", "claude.credential-authority.signal-exit", {
            signal: exit.signal,
          })
          arm(options.retryMs)
          return
        case "code":
          if (exit.code !== 0 && exit.code !== 75)
            options.logger.log("warn", "claude.credential-authority.nonzero-exit", {
              exitCode: exit.code,
            })
          if (exit.code === 0) await evaluate(false)
          else arm(options.retryMs)
          return
        default: {
          const unreachable: never = exit
          throw new InvalidArgumentError("processExit", unreachable)
        }
      }
    } finally {
      activeProcess = undefined
      await process.dispose()
    }
  }
  const start = (canInvoke: boolean): void => {
    if (disposed || evaluation !== undefined) return
    const task = evaluate(canInvoke).catch((error: unknown) => {
      if (disposed && error instanceof OperationCancelledError) return
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
    evaluation = task
    void task.then(
      () => {
        if (evaluation === task) evaluation = undefined
      },
      () => {
        if (evaluation === task) evaluation = undefined
      },
    )
  }
  const handle = createAsyncDisposable(async () => {
    disposed = true
    scheduled?.cancel()
    controller.abort()
    await activeProcess?.terminate()
    await evaluation
  })
  start(true)
  return handle
}
