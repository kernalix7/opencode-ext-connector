import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

import type { BridgeEvent } from "../../src/providers/cursor/bridge-protocol"
import { consumeCursorDirectSession } from "../../src/providers/cursor/direct-stream"
import type {
  CursorRunSession,
  CursorRunSessionRegistry,
} from "../../src/providers/cursor/run-session"
import type {
  CursorDispatchResult,
  CursorServerDispatcher,
} from "../../src/providers/cursor/server-dispatch"
import { parseCursorSessionId } from "../../src/providers/cursor/session-state"

export type DirectFixture = {
  readonly parts: Promise<readonly LanguageModelV3StreamPart[]>
  readonly abortCount: () => number
  readonly terminateCount: () => number
}

export function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

export function directFixture(options: {
  readonly events: readonly BridgeEvent[]
  readonly dispatchBytes?: (bytes: Uint8Array) => CursorDispatchResult
  readonly abortError?: Error
}): DirectFixture {
  const queue = [...options.events]
  let aborts = 0
  let terminations = 0
  const unexpectedDispatch = (): CursorDispatchResult => {
    throw new TypeError("unexpected dispatch")
  }
  const dispatcher: CursorServerDispatcher = {
    dispatch: unexpectedDispatch,
    dispatchBytes: options.dispatchBytes ?? unexpectedDispatch,
    parkedCalls: new Map(),
  }
  const session: CursorRunSession = {
    identity: { sessionId: parseCursorSessionId("direct-stream-round2"), modelId: "auto" },
    dispatcher,
    stream: {
      id: "stream-round2",
      write: async () => undefined,
      nextEvent: async () => {
        const event = queue.shift()
        if (event === undefined) throw new TypeError("test event queue exhausted")
        return event
      },
      abort: async () => undefined,
      close: async () => undefined,
    },
    write: async () => undefined,
    writeContinuations: async () => undefined,
    touch: () => undefined,
    abort: async () => {
      aborts += 1
      if (options.abortError !== undefined) throw options.abortError
    },
    dispose: async () => undefined,
  }
  const registry: CursorRunSessionRegistry = {
    register: () => session,
    find: () => session,
    resolveParkedCalls: () => session,
    terminate: async () => {
      terminations += 1
    },
    size: () => 1,
    dispose: async () => undefined,
  }
  const parts = consumeCursorDirectSession({
    session,
    signal: new AbortController().signal,
    registry,
  }).then((stream) => Array.fromAsync(stream))
  return { parts, abortCount: () => aborts, terminateCount: () => terminations }
}
