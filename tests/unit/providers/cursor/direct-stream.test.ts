import { describe, expect, it } from "bun:test"

import type { BridgeEvent } from "../../../../src/providers/cursor/bridge-protocol"
import { encodeConnectFrame } from "../../../../src/providers/cursor/connect-frame"
import * as directStreamModule from "../../../../src/providers/cursor/direct-stream"
import { consumeCursorDirectSession } from "../../../../src/providers/cursor/direct-stream"
import { CursorProtocolError } from "../../../../src/providers/cursor/proto/errors"
import type {
  CursorRunSession,
  CursorRunSessionRegistry,
} from "../../../../src/providers/cursor/run-session"
import type { CursorServerDispatcher } from "../../../../src/providers/cursor/server-dispatch"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"

type StreamFrame =
  | { readonly kind: "message"; readonly bytes: Uint8Array }
  | {
      readonly kind: "end"
      readonly error: { readonly code: string; readonly message: string } | null
    }

type StreamDecoder = {
  readonly push: (chunk: Uint8Array) => readonly StreamFrame[]
  readonly finish: () => void
}

function createDecoder(options: { readonly maxMessageBytes?: number } = {}): StreamDecoder {
  const factory = Reflect.get(directStreamModule, "createConnectFrameStreamDecoder")
  if (typeof factory !== "function") {
    throw new TypeError("createConnectFrameStreamDecoder must be exported")
  }
  const decoder: unknown = Reflect.apply(factory, undefined, [options])
  if (typeof decoder !== "object" || decoder === null) {
    throw new TypeError("Connect stream decoder must be an object")
  }
  const push = Reflect.get(decoder, "push")
  const finish = Reflect.get(decoder, "finish")
  if (typeof push !== "function" || typeof finish !== "function") {
    throw new TypeError("Connect stream decoder methods are missing")
  }
  return {
    push: (chunk): readonly StreamFrame[] => Reflect.apply(push, decoder, [chunk]),
    finish: (): void => Reflect.apply(finish, decoder, []),
  }
}

function withFlag(frame: Uint8Array, flag: number): Uint8Array {
  const changed = new Uint8Array(frame)
  changed[0] = flag
  return changed
}

function directSession(events: readonly BridgeEvent[]): {
  readonly parts: Promise<readonly unknown[]>
  readonly abortCount: () => number
  readonly terminateCount: () => number
} {
  const queue = [...events]
  let aborts = 0
  let terminations = 0
  const dispatcher: CursorServerDispatcher = {
    dispatch: () => {
      throw new TypeError("unexpected dispatch")
    },
    dispatchBytes: () => {
      throw new TypeError("unexpected dispatch")
    },
    parkedCalls: new Map(),
  }
  const session: CursorRunSession = {
    identity: { sessionId: parseCursorSessionId("direct-stream-test"), modelId: "auto" },
    dispatcher,
    stream: {
      id: "stream-1",
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
  const stream = consumeCursorDirectSession({
    session,
    signal: new AbortController().signal,
    registry,
  }).then((value) => Array.fromAsync(value))
  return { parts: stream, abortCount: () => aborts, terminateCount: () => terminations }
}

describe("Cursor direct Connect stream decoding", () => {
  it("emits a fragmented frame only after its complete payload arrives", () => {
    // Given
    const decoder = createDecoder()
    const payload = Uint8Array.from([1, 2, 3])
    const frame = encodeConnectFrame(payload)

    // When
    const header = decoder.push(frame.subarray(0, 5))
    const body = decoder.push(frame.subarray(5))

    // Then
    expect(header).toEqual([])
    expect(body).toEqual([{ kind: "message", bytes: payload }])
  })

  it("processes every complete frame in one chunk", () => {
    // Given
    const decoder = createDecoder()
    const first = encodeConnectFrame(Uint8Array.from([1]))
    const second = encodeConnectFrame(Uint8Array.from([2]))
    const chunk = new Uint8Array(first.length + second.length)
    chunk.set(first)
    chunk.set(second, first.length)

    // When
    const frames = decoder.push(chunk)

    // Then
    expect(frames).toEqual([
      { kind: "message", bytes: Uint8Array.from([1]) },
      { kind: "message", bytes: Uint8Array.from([2]) },
    ])
  })

  it("rejects unknown flags as soon as the header is complete", () => {
    // Given
    const decoder = createDecoder()
    const header = withFlag(encodeConnectFrame(new Uint8Array()), 0x04).subarray(0, 5)

    // When
    const decode = (): void => {
      decoder.push(header)
    }

    // Then
    expect(decode).toThrow("unsupported flags 0x4")
  })

  it("rejects compressed data without negotiation before buffering its payload", () => {
    // Given
    const decoder = createDecoder()
    const header = encodeConnectFrame(Uint8Array.from([1, 2, 3]), { compressed: true }).subarray(
      0,
      5,
    )

    // When
    const decode = (): void => {
      decoder.push(header)
    }

    // Then
    expect(decode).toThrow("negotiated decompressor")
  })

  it("rejects a compressed end-stream header before parsing terminal JSON", () => {
    // Given
    const decoder = createDecoder()
    const header = encodeConnectFrame(new TextEncoder().encode("not-json"), {
      compressed: true,
      endStream: true,
    }).subarray(0, 5)

    // When
    let failure: unknown
    try {
      decoder.push(header)
    } catch (error) {
      failure = error
    }

    // Then
    expect(failure).toBeInstanceOf(CursorProtocolError)
    if (!(failure instanceof CursorProtocolError)) {
      throw new TypeError("expected CursorProtocolError")
    }
    expect(failure.reason).toBe("unsupported-flags")
    expect(failure.message).toContain("negotiated decompressor")
    expect(failure.message).not.toContain("invalid JSON")
  })

  it("rejects an oversized declared length before buffering its payload", () => {
    // Given
    const decoder = createDecoder({ maxMessageBytes: 2 })
    const header = encodeConnectFrame(Uint8Array.from([1, 2, 3])).subarray(0, 5)

    // When
    const decode = (): void => {
      decoder.push(header)
    }

    // Then
    expect(decode).toThrow("message exceeds 2 bytes")
  })

  it("parses a successful Connect end-stream envelope separately from protobuf", () => {
    // Given
    const decoder = createDecoder()
    const terminal = encodeConnectFrame(new TextEncoder().encode("{}"), { endStream: true })

    // When
    const frames = decoder.push(terminal)

    // Then
    expect(frames).toEqual([{ kind: "end", error: null }])
  })

  it("parses a Connect end-stream error separately from protobuf", () => {
    // Given
    const decoder = createDecoder()
    const json = JSON.stringify({ error: { code: "internal", message: "upstream failed" } })

    // When
    const frames = decoder.push(
      encodeConnectFrame(new TextEncoder().encode(json), { endStream: true }),
    )

    // Then
    expect(frames).toEqual([
      { kind: "end", error: { code: "internal", message: "upstream failed" } },
    ])
  })

  it("rejects malformed Connect end-stream JSON at the boundary", () => {
    // Given
    const decoder = createDecoder()
    const terminal = encodeConnectFrame(new TextEncoder().encode("not-json"), {
      endStream: true,
    })

    // When
    const decode = (): void => {
      decoder.push(terminal)
    }

    // Then
    expect(decode).toThrow("end-stream")
  })

  it("rejects transport end with trailing partial bytes", () => {
    // Given
    const decoder = createDecoder()
    decoder.push(encodeConnectFrame(Uint8Array.from([1, 2])).subarray(0, 6))

    // When
    const finish = (): void => decoder.finish()

    // Then
    expect(finish).toThrow("trailing partial")
  })

  it("rejects a nonzero Connect trailer status", async () => {
    // Given
    const fixture = directSession([
      { kind: "trailers", id: "stream-1", headers: { "connect-status": "13" } },
    ])

    // When
    const result = fixture.parts

    // Then
    await expect(result).rejects.toEqual(
      expect.objectContaining({
        bridgeCode: "connect-status-13",
      }),
    )
    expect(fixture.abortCount()).toBe(1)
    expect(fixture.terminateCount()).toBe(0)
  })

  it("accepts plain transport end only after a successful Connect trailer", async () => {
    // Given
    const fixture = directSession([
      { kind: "trailers", id: "stream-1", headers: { "connect-status": "0" } },
      { kind: "end", id: "stream-1" },
    ])

    // When
    const parts = await fixture.parts

    // Then
    expect(parts.at(-1)).toMatchObject({
      type: "finish",
      finishReason: { unified: "stop" },
    })
    expect(fixture.abortCount()).toBe(0)
    expect(fixture.terminateCount()).toBe(1)
  })

  it("rejects plain transport end before a terminal state", async () => {
    // Given
    const fixture = directSession([{ kind: "end", id: "stream-1" }])

    // When
    const result = fixture.parts

    // Then
    await expect(result).rejects.toEqual(expect.objectContaining({ bridgeCode: "premature-end" }))
    expect(fixture.abortCount()).toBe(1)
    expect(fixture.terminateCount()).toBe(0)
  })

  it("rejects bridge end when data leaves a trailing partial frame", async () => {
    // Given
    const partial = encodeConnectFrame(Uint8Array.from([1, 2])).subarray(0, 6)
    const fixture = directSession([
      { kind: "data", id: "stream-1", payload: partial },
      { kind: "trailers", id: "stream-1", headers: { "connect-status": "0" } },
      { kind: "end", id: "stream-1" },
    ])

    // When
    const result = fixture.parts

    // Then
    await expect(result).rejects.toThrow("trailing partial")
    expect(fixture.abortCount()).toBe(1)
    expect(fixture.terminateCount()).toBe(0)
  })
})
