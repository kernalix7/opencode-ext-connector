import { describe, expect, it } from "bun:test"

import { encodeConnectFrame } from "../../../../src/providers/cursor/connect-frame"
import {
  CursorDirectStreamError,
  consumeCursorDirectAttempt,
} from "../../../../src/providers/cursor/direct-stream"
import type { CursorIdleWatchdog } from "../../../../src/providers/cursor/recovery"
import type { CursorRunSession } from "../../../../src/providers/cursor/run-session"
import type { CursorDispatchResult } from "../../../../src/providers/cursor/server-dispatch"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"
import { createCursorStreamAdapter } from "../../../../src/providers/cursor/stream-adapter"

describe("Cursor direct attempt recovery boundaries", () => {
  it("emits no tool call and clears ownership when a batch also contains stranding drift", async () => {
    // Given
    const parkedCalls = new Map()
    const outcomes: CursorDispatchResult[] = [
      {
        outcome: {
          kind: "mcp-parked",
          parked: {
            callId: "call-1",
            execId: "exec-1",
            execMessageId: 1,
            args: {
              name: "read",
              toolName: "read",
              toolCallId: "call-1",
              providerIdentifier: "opencode",
              args: {},
            },
          },
        },
        replyFrames: [],
        closeStream: false,
      },
      {
        outcome: {
          kind: "drift",
          area: "mcp-call",
          detail: "duplicate-call-id",
          stranding: true,
        },
        replyFrames: [],
        closeStream: false,
      },
    ]
    const session: CursorRunSession = {
      identity: { sessionId: parseCursorSessionId("drift-session"), modelId: "auto" },
      dispatcher: {
        parkedCalls,
        dispatch: () => {
          throw new TypeError("unexpected dispatch")
        },
        dispatchBytes: () => {
          const result = outcomes.shift()
          if (result === undefined) throw new TypeError("missing dispatch fixture")
          if (result.outcome.kind === "mcp-parked") {
            parkedCalls.set(result.outcome.parked.callId, result.outcome.parked)
          }
          return result
        },
      },
      stream: {
        id: "stream-1",
        write: async () => undefined,
        nextEvent: async () => ({
          kind: "data",
          id: "stream-1",
          payload: new Uint8Array([
            ...encodeConnectFrame(Uint8Array.of(1)),
            ...encodeConnectFrame(Uint8Array.of(2)),
          ]),
        }),
        abort: async () => undefined,
        close: async () => undefined,
      },
      write: async () => undefined,
      writeContinuations: async () => undefined,
      touch: () => undefined,
      abort: async () => undefined,
      dispose: async () => undefined,
    }
    const signal = new AbortController().signal
    const watchdog: CursorIdleWatchdog = {
      signal,
      expired: () => false,
      progress: () => undefined,
      heartbeat: () => undefined,
      park: () => undefined,
      dispose: () => undefined,
    }
    const adapter = createCursorStreamAdapter()

    // When
    const attempt = consumeCursorDirectAttempt({ session, signal, watchdog, adapter })

    // Then
    await expect(attempt).rejects.toBeInstanceOf(CursorDirectStreamError)
    expect(adapter.replayState().toolBoundary).toBe(false)
    expect(parkedCalls.size).toBe(0)
    const reader = adapter.stream.getReader()
    expect(await reader.read()).toEqual({
      value: { type: "stream-start", warnings: [] },
      done: false,
    })
    await reader.cancel()
  })
})
