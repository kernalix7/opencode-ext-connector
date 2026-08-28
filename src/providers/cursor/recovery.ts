import type { Clock, ScheduledCallback } from "../../core/clock"
import { InvalidArgumentError, OperationCancelledError } from "../../core/errors"
import {
  type CursorProtocolFailureProjection,
  projectCursorProtocolFailure,
} from "./protocol-failure"

export type CursorRecoveryAttemptMode = "initial" | "checkpoint" | "history"

export type CursorReplayState = {
  readonly outputEpoch: number
  readonly checkpointEpoch: number | null
  readonly toolBoundary: boolean
}

export type CursorRecoveryDecision =
  | { readonly kind: "retry"; readonly mode: "checkpoint" | "history" }
  | {
      readonly kind: "fail"
      readonly reason: "exhausted" | "replay-unsafe" | "non-retryable"
    }

export class CursorRecoveryError extends Error {
  public override readonly name = "CursorRecoveryError"
  public readonly code = "CURSOR_RECOVERY_ERROR"
  public readonly protocolFailure: CursorProtocolFailureProjection | null

  public constructor(
    public readonly reason: "idle" | "exhausted" | "replay-unsafe" | "non-retryable",
    public readonly attemptedModes: readonly CursorRecoveryAttemptMode[],
    public readonly retryable: boolean,
    public override readonly cause: unknown = null,
  ) {
    super(`Cursor recovery failed: ${reason}`, { cause })
    this.protocolFailure = projectCursorProtocolFailure(cause)
  }
}

export type CursorRecoveryPlanner = {
  readonly next: (input: {
    readonly checkpointAvailable: boolean
    readonly replay: CursorReplayState
    readonly retryable: boolean
  }) => CursorRecoveryDecision
  readonly requireRetry: (
    decision: CursorRecoveryDecision,
    cause: unknown,
  ) => "checkpoint" | "history"
  readonly attemptedModes: () => readonly CursorRecoveryAttemptMode[]
}

export function createCursorRecoveryPlanner(): CursorRecoveryPlanner {
  const attempted: CursorRecoveryAttemptMode[] = ["initial"]
  let checkpointTried = false
  let historyTried = false
  const next: CursorRecoveryPlanner["next"] = (input) => {
    if (!input.retryable || input.replay.toolBoundary) {
      return { kind: "fail", reason: "non-retryable" }
    }
    const checkpointCoversOutput =
      input.replay.checkpointEpoch !== null &&
      input.replay.checkpointEpoch === input.replay.outputEpoch
    if (!checkpointTried && input.checkpointAvailable && checkpointCoversOutput) {
      checkpointTried = true
      attempted.push("checkpoint")
      return { kind: "retry", mode: "checkpoint" }
    }
    if (input.replay.outputEpoch > 0) {
      return { kind: "fail", reason: "replay-unsafe" }
    }
    if (!historyTried) {
      historyTried = true
      attempted.push("history")
      return { kind: "retry", mode: "history" }
    }
    return { kind: "fail", reason: "exhausted" }
  }
  return {
    next,
    requireRetry: (decision, cause) => {
      if (decision.kind === "retry") return decision.mode
      throw new CursorRecoveryError(
        decision.reason,
        [...attempted],
        decision.reason === "exhausted",
        cause,
      )
    },
    attemptedModes: (): readonly CursorRecoveryAttemptMode[] => [...attempted],
  }
}

export type CursorIdleWatchdog = {
  readonly signal: AbortSignal
  readonly expired: () => boolean
  readonly progress: () => void
  readonly heartbeat: () => void
  readonly park: () => void
  readonly dispose: () => void
}

export function createCursorIdleWatchdog(options: {
  readonly clock: Clock
  readonly idleTimeoutMs?: number
  readonly parentSignal: AbortSignal
}): CursorIdleWatchdog {
  const idleTimeoutMs = options.idleTimeoutMs ?? 60_000
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 0) {
    throw new InvalidArgumentError("idleTimeoutMs")
  }
  const controller = new AbortController()
  let timer: ScheduledCallback | null = null
  let disposed = false
  const cancelTimer = (): void => {
    timer?.cancel()
    timer = null
  }
  const expire = (): void => {
    timer = null
    if (!controller.signal.aborted) {
      controller.abort(new CursorRecoveryError("idle", ["initial"], true))
    }
  }
  const arm = (): void => {
    cancelTimer()
    if (!disposed && !controller.signal.aborted) {
      timer = options.clock.schedule(idleTimeoutMs, expire)
    }
  }
  const onParentAbort = (): void => {
    cancelTimer()
    if (!controller.signal.aborted) {
      controller.abort(new OperationCancelledError("cursor-direct-stream"))
    }
  }
  options.parentSignal.addEventListener("abort", onParentAbort, { once: true })
  if (options.parentSignal.aborted) onParentAbort()
  else arm()
  return {
    signal: controller.signal,
    expired: (): boolean =>
      controller.signal.aborted && controller.signal.reason instanceof CursorRecoveryError,
    progress: arm,
    heartbeat: () => undefined,
    park: cancelTimer,
    dispose: () => {
      disposed = true
      cancelTimer()
      options.parentSignal.removeEventListener("abort", onParentAbort)
    },
  }
}
