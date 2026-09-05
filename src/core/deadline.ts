import type { Clock } from "./clock.js"
import {
  DeadlineExceededError,
  InvalidArgumentError,
  OperationCancelledError,
  ResourceDisposedError,
} from "./errors.js"
import type { AsyncDisposableHandle } from "./lifecycle.js"
import { createAsyncDisposable } from "./lifecycle.js"

export type DeadlineOptions = {
  readonly clock: Clock
  readonly timeoutMs: number
  readonly parentSignal: AbortSignal | null
}

export interface Deadline extends AsyncDisposableHandle {
  readonly signal: AbortSignal
  readonly expiresAtMs: number
  remainingMs(): number
}

export function createDeadline(options: DeadlineOptions): Deadline {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0) {
    throw new InvalidArgumentError("timeoutMs")
  }
  const expiresAtMs = options.clock.nowMs() + options.timeoutMs
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new InvalidArgumentError("timeoutMs")
  }
  const controller = new AbortController()
  const onParentAbort = (): void => {
    scheduled?.cancel()
    if (!controller.signal.aborted) {
      controller.abort(new OperationCancelledError("deadline-parent"))
    }
  }
  let scheduled =
    options.timeoutMs > 0
      ? options.clock.schedule(options.timeoutMs, () => {
          if (options.parentSignal !== null) {
            options.parentSignal.removeEventListener("abort", onParentAbort)
          }
          if (!controller.signal.aborted) {
            controller.abort(new DeadlineExceededError(options.timeoutMs))
          }
        })
      : null

  if (options.parentSignal?.aborted === true) {
    onParentAbort()
  } else if (options.parentSignal !== null) {
    options.parentSignal.addEventListener("abort", onParentAbort, { once: true })
  }
  if (options.timeoutMs === 0 && !controller.signal.aborted) {
    controller.abort(new DeadlineExceededError(options.timeoutMs))
  }

  const disposal = createAsyncDisposable(() => {
    scheduled?.cancel()
    scheduled = null
    if (options.parentSignal !== null) {
      options.parentSignal.removeEventListener("abort", onParentAbort)
    }
    if (!controller.signal.aborted) {
      controller.abort(new ResourceDisposedError("deadline"))
    }
  })
  return {
    signal: controller.signal,
    expiresAtMs,
    remainingMs: () => Math.max(0, expiresAtMs - options.clock.nowMs()),
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
