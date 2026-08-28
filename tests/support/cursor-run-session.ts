import type { CursorBridgeStream } from "../../src/providers/cursor/bridge-client"
import type { CursorServerDispatcher } from "../../src/providers/cursor/server-dispatch"
import { parseCursorSessionId } from "../../src/providers/cursor/session-state"

export type CursorRunSessionResourceOptions = {
  readonly key: string
  readonly callIds: readonly string[]
  readonly modelId?: string
  readonly writes?: Uint8Array[]
  readonly released?: { count: number }
  readonly write?: (frame: Uint8Array) => Promise<void>
  readonly close?: () => Promise<void>
}

export function cursorRunSessionResources(options: CursorRunSessionResourceOptions) {
  const writes = options.writes ?? []
  const released = options.released ?? { count: 0 }
  const parkedCalls = new Map(
    options.callIds.map((callId) => [
      callId,
      {
        callId,
        execId: `exec-${callId}`,
        execMessageId: 7,
        args: {
          name: "read",
          args: {},
          toolCallId: callId,
          providerIdentifier: "opencode",
          toolName: "read",
        },
      },
    ]),
  )
  const stream: CursorBridgeStream = {
    id: options.key,
    write:
      options.write ??
      (async (frame) => {
        writes.push(new Uint8Array(frame))
      }),
    nextEvent: async () => ({ kind: "end", id: options.key }),
    abort: async () => undefined,
    close:
      options.close ??
      (async () => {
        released.count += 1
      }),
  }
  const dispatcher: CursorServerDispatcher = {
    dispatch: () => {
      throw new Error("unused")
    },
    dispatchBytes: () => {
      throw new Error("unused")
    },
    parkedCalls,
  }
  return {
    sessionId: parseCursorSessionId(options.key),
    modelId: options.modelId ?? "model",
    stream,
    dispatcher,
    ownership: {
      blobIds: [],
      release: () => {
        released.count += 1
      },
      [Symbol.dispose]: () => undefined,
    },
    disposeStores: () => {
      released.count += 1
    },
    parkedCalls,
  }
}
