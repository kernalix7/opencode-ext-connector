import {
  type ConnectFrameStreamDecoder,
  type ConnectStreamFrame,
  createConnectFrameStreamDecoder,
} from "./connect-frame-stream"
import { annotateCursorProtocolFailure } from "./protocol-failure"
import type { CursorIdleWatchdog } from "./recovery"
import type { CursorRunSession, CursorRunSessionRegistry } from "./run-session"
import type { CursorDispatchResult } from "./server-dispatch"
import { type CursorStreamAdapter, createCursorStreamAdapter } from "./stream-adapter"

export { createConnectFrameStreamDecoder } from "./connect-frame-stream"

export type CursorDirectAttemptExit = { readonly kind: "terminal" } | { readonly kind: "parked" }

function finishConnectDecoder(decoder: ConnectFrameStreamDecoder): void {
  try {
    decoder.finish()
  } catch (error) {
    annotateCursorProtocolFailure(error, "connect-frame")
  }
}

function assertNoStranding(
  results: readonly CursorDispatchResult[],
  session: CursorRunSession,
): void {
  const stranded = results.find(
    (result) => result.outcome.kind === "drift" && result.outcome.stranding,
  )
  if (stranded?.outcome.kind === "drift") {
    session.dispatcher.parkedCalls.clear()
    throw new CursorDirectStreamError(`stranding-drift:${stranded.outcome.detail}`)
  }
}

async function applyDispatch(options: {
  readonly result: CursorDispatchResult
  readonly session: CursorRunSession
  readonly signal: AbortSignal
  readonly watchdog: CursorIdleWatchdog
  readonly adapter: CursorStreamAdapter
}): Promise<CursorDirectAttemptExit | null> {
  for (const reply of options.result.replyFrames) {
    await options.session.write(reply, options.signal)
  }
  const outcome = options.result.outcome
  if (outcome.kind === "heartbeat") {
    options.watchdog.heartbeat()
    return null
  }
  options.watchdog.progress()
  switch (outcome.kind) {
    case "text":
    case "thinking":
      options.adapter.emit(outcome)
      return null
    case "checkpoint":
      if (outcome.stored) options.adapter.noteCheckpoint()
      return null
    case "turn-ended":
      return { kind: "terminal" }
    case "mcp-parked":
      options.adapter.emit(outcome)
      options.watchdog.park()
      return { kind: "parked" }
    case "control":
      throw new CursorDirectStreamError("server-abort")
    case "drift":
      if (outcome.stranding) throw new CursorDirectStreamError("stranding-drift")
      return null
    default:
      return null
  }
}

export async function consumeCursorDirectAttempt(options: {
  readonly session: CursorRunSession
  readonly signal: AbortSignal
  readonly watchdog: CursorIdleWatchdog
  readonly adapter: CursorStreamAdapter
}): Promise<CursorDirectAttemptExit> {
  const decoder = createConnectFrameStreamDecoder()
  let terminalSeen = false
  for (;;) {
    const event = await options.session.stream.nextEvent(options.signal)
    if (event.kind === "error") throw new CursorDirectStreamError(event.code, event.message)
    if (event.kind === "headers" && (event.status < 200 || event.status >= 300)) {
      throw new CursorDirectStreamError(`http-${event.status}`)
    }
    if (event.kind === "trailers") {
      const status = event.headers["connect-status"]
      if (status !== undefined && status !== "0") {
        throw new CursorDirectStreamError(`connect-status-${status}`)
      }
      terminalSeen = status === "0" || terminalSeen
      continue
    }
    if (event.kind === "end") {
      finishConnectDecoder(decoder)
      if (!terminalSeen) throw new CursorDirectStreamError("premature-end")
      return { kind: "terminal" }
    }
    if (event.kind !== "data") continue
    let frames: readonly ConnectStreamFrame[]
    try {
      frames = decoder.push(event.payload)
    } catch (error) {
      annotateCursorProtocolFailure(error, "connect-frame")
    }
    let results: CursorDispatchResult[]
    try {
      results = frames
        .filter((frame) => frame.kind === "message")
        .map((frame) => options.session.dispatcher.dispatchBytes(frame.bytes))
    } catch (error) {
      annotateCursorProtocolFailure(error, "server-dispatch")
    }
    assertNoStranding(results, options.session)
    for (const [index, frame] of frames.entries()) {
      if (frame.kind === "end") {
        if (frame.error !== null) {
          throw new CursorDirectStreamError(frame.error.code, frame.error.message)
        }
        terminalSeen = true
        continue
      }
      const result = results.shift()
      if (result === undefined) throw new CursorDirectStreamError("missing-dispatch-result")
      const exit = await applyDispatch({ ...options, result })
      if (exit?.kind === "terminal") {
        if (index !== frames.length - 1) {
          const trailingFrame = frames.at(index + 1)
          if (frames.length - index !== 2 || trailingFrame?.kind !== "end") {
            throw new CursorDirectStreamError("trailing-frame-after-turn-ended")
          }
          if (trailingFrame.error !== null) {
            throw new CursorDirectStreamError(trailingFrame.error.code, trailingFrame.error.message)
          }
        }
        finishConnectDecoder(decoder)
        return exit
      }
      if (exit !== null) return exit
    }
    if (terminalSeen) return { kind: "terminal" }
  }
}

export async function consumeCursorDirectSession(options: {
  readonly session: CursorRunSession
  readonly signal: AbortSignal
  readonly registry: CursorRunSessionRegistry
}): Promise<CursorStreamAdapter["stream"]> {
  const adapter = createCursorStreamAdapter()
  const watchdog: CursorIdleWatchdog = {
    signal: options.signal,
    expired: () => false,
    progress: () => undefined,
    heartbeat: () => undefined,
    park: () => undefined,
    dispose: () => undefined,
  }
  void consumeCursorDirectAttempt({ ...options, watchdog, adapter }).then(
    async (exit) => {
      if (exit.kind === "terminal") await options.registry.terminate(options.session.identity)
      else options.session.touch()
      adapter.finish(exit.kind === "parked" ? "tool-calls" : "stop")
    },
    async (error: unknown) => {
      try {
        await options.session.abort()
      } catch (cleanupError) {
        adapter.fail(
          new AggregateError(
            [error, cleanupError],
            "Cursor direct stream failure and abort cleanup failure",
          ),
        )
        return
      }
      adapter.fail(error)
    },
  )
  return adapter.stream
}

export function isCursorRetryableStreamError(error: unknown): boolean {
  if (!(error instanceof CursorDirectStreamError)) return false
  if (error.bridgeCode === "premature-end") return true
  if (
    [
      "stream-error",
      "stream-unavailable",
      "session-error",
      "session-goaway",
      "session-ping-error",
    ].includes(error.bridgeCode)
  )
    return true
  if (error.bridgeCode.startsWith("http-")) {
    const status = Number(error.bridgeCode.slice(5))
    return status === 408 || status === 429 || status >= 500
  }
  if (error.bridgeCode.startsWith("connect-status-")) {
    return ["4", "8", "13", "14"].includes(error.bridgeCode.slice(15))
  }
  return false
}

export class CursorDirectStreamError extends Error {
  public override readonly name = "CursorDirectStreamError"
  public readonly code = "CURSOR_DIRECT_STREAM_ERROR"
  public constructor(
    public readonly bridgeCode: string,
    public readonly bridgeMessage?: string,
  ) {
    super(bridgeMessage ?? "Cursor direct stream failed")
  }
}
