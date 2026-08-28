import { describe, expect, it } from "bun:test"

import { createCursorBlobStore } from "../../../../src/providers/cursor/blob-store"
import { createCursorCheckpointStore } from "../../../../src/providers/cursor/checkpoint-store"
import { decodeConnectFramesStrict } from "../../../../src/providers/cursor/connect-frame"
import { decodeAgentClientMessage } from "../../../../src/providers/cursor/proto/request"
import type { AgentServerMessage } from "../../../../src/providers/cursor/proto/server"
import {
  concatBytes,
  encodeBytesField,
  encodeStringField,
} from "../../../../src/providers/cursor/proto-wire"
import {
  type CursorServerDispatcher,
  createCursorServerDispatcher,
} from "../../../../src/providers/cursor/server-dispatch"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

function createDispatcher(): CursorServerDispatcher {
  const clock = new FakeClock()
  const blobStore = createCursorBlobStore({ clock, maxBytes: 1_024, maxEntries: 16, ttlMs: 100 })
  const checkpointStore = createCursorCheckpointStore({
    blobStore,
    clock,
    maxBytes: 1_024,
    maxEntries: 4,
    ttlMs: 100,
  })
  return createCursorServerDispatcher({
    blobStore,
    checkpointStore,
    sessionId: parseCursorSessionId("dispatch-session"),
    tools: [{ name: "read", description: "Read", inputSchema: { type: "object" } }],
  })
}

function decodeReply(frame: Uint8Array): ReturnType<typeof decodeAgentClientMessage> {
  const decoded = decodeConnectFramesStrict(frame)
  const first = decoded.at(0)
  if (first === undefined) throw new Error("fixture expected one Connect frame")
  return decodeAgentClientMessage(first.bytes)
}

describe("createCursorServerDispatcher interaction updates", () => {
  it("dispatches text, thinking, tokens, and turn end as typed outcomes", () => {
    // Given
    const dispatcher = createDispatcher()

    // When
    const outcomes = [
      dispatcher.dispatch({
        kind: "interaction-update",
        update: { kind: "text-delta", text: "a" },
      }),
      dispatcher.dispatch({
        kind: "interaction-update",
        update: { kind: "thinking-delta", text: "b" },
      }),
      dispatcher.dispatch({
        kind: "interaction-update",
        update: { kind: "token-delta", tokens: 3 },
      }),
      dispatcher.dispatch({ kind: "interaction-update", update: { kind: "turn-ended" } }),
    ]

    // Then
    expect(outcomes.map(({ outcome }) => outcome)).toEqual([
      { kind: "text", text: "a" },
      { kind: "thinking", text: "b" },
      { kind: "tokens", tokens: 3 },
      { kind: "turn-ended" },
    ])
  })

  it("classifies heartbeat and known non-stranding telemetry", () => {
    // Given
    const dispatcher = createDispatcher()

    // When
    const heartbeat = dispatcher.dispatch({
      kind: "interaction-update",
      update: { kind: "heartbeat" },
    })
    const telemetry = dispatcher.dispatch({
      kind: "interaction-update",
      update: { kind: "summary", payload: new Uint8Array([1]) },
    })

    // Then
    expect(heartbeat.outcome).toEqual({ kind: "heartbeat" })
    expect(telemetry.outcome).toEqual({ kind: "telemetry", name: "summary" })
  })

  it("continues from opaque field 25 through text and turn end without side effects", () => {
    // Given
    const dispatcher = createDispatcher()

    // When
    const results = [
      dispatcher.dispatch({
        kind: "interaction-update",
        update: { kind: "field-25", payload: new Uint8Array([0xde, 0xad]) },
      }),
      dispatcher.dispatch({
        kind: "interaction-update",
        update: { kind: "text-delta", text: "after field 25" },
      }),
      dispatcher.dispatch({ kind: "interaction-update", update: { kind: "turn-ended" } }),
    ]

    // Then
    expect(results.map(({ outcome }) => outcome)).toEqual([
      { kind: "telemetry", name: "field-25" },
      { kind: "text", text: "after field 25" },
      { kind: "turn-ended" },
    ])
    expect(results.map(({ replyFrames }) => replyFrames)).toEqual([[], [], []])
    expect(results.map(({ closeStream }) => closeStream)).toEqual([false, false, false])
    expect(dispatcher.parkedCalls.size).toBe(0)
  })

  it("keeps field 25 telemetry while dispatching a semantic text update in the same bytes", () => {
    // Given
    const dispatcher = createDispatcher()
    const interactionUpdate = concatBytes([
      new Uint8Array([0xc8, 0x01, 0x01]),
      encodeBytesField(1, encodeStringField(1, "semantic")),
    ])
    const message = encodeBytesField(1, interactionUpdate)

    // When
    const result = dispatcher.dispatchBytes(message)

    // Then
    expect(result.outcome).toEqual({ kind: "text", text: "semantic" })
    expect(result.replyFrames).toEqual([])
    expect(result.closeStream).toBe(false)
    expect(dispatcher.parkedCalls.size).toBe(0)
  })
})

describe("createCursorServerDispatcher exec messages", () => {
  it("replies to request context with registered MCP tools and exact exec identity", () => {
    // Given
    const dispatcher = createDispatcher()

    // When
    const result = dispatcher.dispatch({
      kind: "exec-server-message",
      message: { kind: "request-context-args", id: 7, execId: "exec-a" },
    })

    // Then
    expect(result.outcome).toEqual({ kind: "request-context-replied", id: 7, execId: "exec-a" })
    expect(result.replyFrames).toHaveLength(1)
    expect(decodeReply(result.replyFrames[0] ?? new Uint8Array())).toMatchObject({
      kind: "exec-client-message",
      message: {
        kind: "request-context-result",
        id: 7,
        execId: "exec-a",
        result: { kind: "success", requestContext: { tools: [{ name: "read" }] } },
      },
    })
  })

  it("parks MCP args in the exact descriptor returned to direct stream without closing", () => {
    // Given
    const dispatcher = createDispatcher()
    const message: AgentServerMessage = {
      kind: "exec-server-message",
      message: {
        kind: "mcp-args",
        id: 8,
        execId: "exec-b",
        args: {
          name: "read",
          args: { path: "x" },
          toolCallId: "call-b",
          providerIdentifier: "opencode",
          toolName: "read",
        },
      },
    }

    // When
    const result = dispatcher.dispatch(message)

    // Then
    expect(result.outcome).toEqual({
      kind: "mcp-parked",
      parked: {
        callId: "call-b",
        execId: "exec-b",
        execMessageId: 8,
        args: {
          name: "read",
          args: { path: "x" },
          toolCallId: "call-b",
          providerIdentifier: "opencode",
          toolName: "read",
        },
      },
    })
    expect(result.replyFrames).toEqual([])
    expect(result.closeStream).toBe(false)
    expect(result.outcome.kind).toBe("mcp-parked")
    if (result.outcome.kind === "mcp-parked") {
      expect(dispatcher.parkedCalls.get("call-b")).toBe(result.outcome.parked)
    }
  })

  it("rejects duplicate call IDs without replacing or leaking the parked call", () => {
    // Given
    const dispatcher = createDispatcher()
    const first: AgentServerMessage = {
      kind: "exec-server-message",
      message: {
        kind: "mcp-args",
        id: 1,
        execId: "first",
        args: {
          name: "read",
          args: {},
          toolCallId: "duplicate",
          providerIdentifier: "opencode",
          toolName: "read",
        },
      },
    }
    dispatcher.dispatch(first)

    // When
    const duplicate = dispatcher.dispatch({
      ...first,
      message: { ...first.message, execId: "second" },
    })

    // Then
    expect(duplicate.outcome).toEqual({
      kind: "drift",
      area: "mcp-call",
      detail: "duplicate-call-id",
      stranding: true,
    })
    expect(dispatcher.parkedCalls.size).toBe(1)
    expect(dispatcher.parkedCalls.get("duplicate")?.execId).toBe("first")
  })
})
