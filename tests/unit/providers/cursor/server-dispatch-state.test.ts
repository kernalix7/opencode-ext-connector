import { describe, expect, it } from "bun:test"

import { createCursorBlobStore } from "../../../../src/providers/cursor/blob-store"
import { createCursorCheckpointStore } from "../../../../src/providers/cursor/checkpoint-store"
import { decodeConnectFramesStrict } from "../../../../src/providers/cursor/connect-frame"
import {
  type ConversationCheckpoint,
  encodeConversationCheckpoint,
} from "../../../../src/providers/cursor/proto/checkpoint"
import { CursorProtocolError } from "../../../../src/providers/cursor/proto/errors"
import { decodeAgentClientMessage } from "../../../../src/providers/cursor/proto/request"
import { encodeBoolField, encodeBytesField } from "../../../../src/providers/cursor/proto-wire"
import {
  type CursorServerDispatcher,
  createCursorServerDispatcher,
} from "../../../../src/providers/cursor/server-dispatch"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

function setup(): {
  readonly dispatcher: CursorServerDispatcher
  readonly blobStore: ReturnType<typeof createCursorBlobStore>
  readonly checkpointStore: ReturnType<typeof createCursorCheckpointStore>
} {
  const clock = new FakeClock()
  const blobStore = createCursorBlobStore({ clock, maxBytes: 1_024, maxEntries: 16, ttlMs: 100 })
  const checkpointStore = createCursorCheckpointStore({
    blobStore,
    clock,
    maxBytes: 1_024,
    maxEntries: 4,
    ttlMs: 100,
  })
  return {
    dispatcher: createCursorServerDispatcher({
      blobStore,
      checkpointStore,
      sessionId: parseCursorSessionId("state-session"),
      tools: [],
    }),
    blobStore,
    checkpointStore,
  }
}

function reply(frame: Uint8Array): ReturnType<typeof decodeAgentClientMessage> {
  const first = decodeConnectFramesStrict(frame).at(0)
  if (first === undefined) throw new Error("fixture expected a reply frame")
  return decodeAgentClientMessage(first.bytes)
}

const EMPTY_CHECKPOINT = {
  rootPromptMessageBlobIds: [],
  legacyTurnBlobIds: [],
  todoBlobIds: [],
  pendingToolCalls: [],
  turnBlobIds: [],
  previousWorkspaceUris: [],
  fileStates: [],
  summaryArchiveBlobIds: [],
  turnTimingMessages: [],
  fileStatesV2: [],
  subagentStates: [],
  readPaths: [],
  trackedGitRepoBranches: [],
} satisfies ConversationCheckpoint

describe("createCursorServerDispatcher KV and checkpoint state", () => {
  it("verifies set hashes and returns stored bytes on get with pinned miss shape", () => {
    // Given
    const { dispatcher, blobStore } = setup()
    const bytes = new Uint8Array([4, 5])
    const id = blobStore.hash(bytes)
    const wireId = Uint8Array.from(Buffer.from(id, "hex"))

    // When
    const set = dispatcher.dispatch({
      kind: "kv-server-message",
      message: { kind: "set-blob", id: 2, blobId: wireId, blobData: bytes },
    })
    const get = dispatcher.dispatch({
      kind: "kv-server-message",
      message: { kind: "get-blob", id: 3, blobId: wireId },
    })
    const missId = Uint8Array.from(Buffer.from(blobStore.hash(new Uint8Array([9])), "hex"))
    const miss = dispatcher.dispatch({
      kind: "kv-server-message",
      message: { kind: "get-blob", id: 4, blobId: missId },
    })

    // Then
    expect(set.outcome).toEqual({ kind: "kv-set", id: 2, stored: true })
    expect(get.outcome).toEqual({ kind: "kv-get", id: 3, found: true })
    expect(reply(get.replyFrames[0] ?? new Uint8Array())).toMatchObject({
      kind: "kv-client-message",
      message: { kind: "get-blob-result", id: 3, blobData: bytes },
    })
    expect(reply(miss.replyFrames[0] ?? new Uint8Array())).toEqual({
      kind: "kv-client-message",
      message: { kind: "get-blob-result", id: 4 },
    })
  })

  it("reports a hash mismatch before acknowledging a KV set", () => {
    // Given
    const { dispatcher, blobStore } = setup()
    const wrongId = Uint8Array.from(Buffer.from(blobStore.hash(new Uint8Array([1])), "hex"))

    // When
    const result = dispatcher.dispatch({
      kind: "kv-server-message",
      message: { kind: "set-blob", id: 5, blobId: wrongId, blobData: new Uint8Array([2]) },
    })

    // Then
    expect(result.outcome).toEqual({ kind: "kv-set", id: 5, stored: false })
    expect(reply(result.replyFrames[0] ?? new Uint8Array())).toMatchObject({
      kind: "kv-client-message",
      message: { kind: "set-blob-result", id: 5, error: "blob-id-mismatch" },
    })
  })

  it("retains valid checkpoint blob refs and rejects stale checkpoint refs", () => {
    // Given
    const { dispatcher, blobStore, checkpointStore } = setup()
    const present = blobStore.put(new Uint8Array([7]))
    if (present === null) throw new Error("fixture blob must fit")
    const presentWire = Uint8Array.from(Buffer.from(present, "hex"))
    const missingWire = Uint8Array.from(Buffer.from(blobStore.hash(new Uint8Array([8])), "hex"))

    // When
    const stored = dispatcher.dispatch({
      kind: "conversation-checkpoint-update",
      checkpoint: { ...EMPTY_CHECKPOINT, rootPromptMessageBlobIds: [presentWire] },
    })
    const stale = dispatcher.dispatch({
      kind: "conversation-checkpoint-update",
      checkpoint: { ...EMPTY_CHECKPOINT, rootPromptMessageBlobIds: [missingWire] },
    })

    // Then
    expect(stored.outcome).toEqual({ kind: "checkpoint", stored: true })
    expect(stale.outcome).toEqual({ kind: "checkpoint", stored: false })
    expect(checkpointStore.resume(parseCursorSessionId("state-session"))?.bytes).toEqual(
      encodeConversationCheckpoint({
        ...EMPTY_CHECKPOINT,
        rootPromptMessageBlobIds: [presentWire],
      }),
    )
  })
})

describe("createCursorServerDispatcher rejection and drift", () => {
  it("treats raw metadata exec frames as no-reply telemetry without changing parked calls", () => {
    // Given
    const { dispatcher } = setup()
    const parked = {
      callId: "parked-call",
      execId: "parked-exec",
      execMessageId: 41,
      args: {
        name: "read",
        args: {},
        toolCallId: "parked-call",
        providerIdentifier: "opencode",
        toolName: "read",
      },
    }
    dispatcher.parkedCalls.set(parked.callId, parked)
    const frame = encodeBytesField(2, encodeBoolField(55, false))

    // When
    const result = dispatcher.dispatchBytes(frame)

    // Then
    expect(result).toEqual({
      outcome: { kind: "telemetry", name: "metadata" },
      replyFrames: [],
      closeStream: false,
    })
    expect([...dispatcher.parkedCalls.entries()]).toEqual([[parked.callId, parked]])
  })

  it("rejects native exec without closing the stream and preserves exact identity", () => {
    // Given
    const { dispatcher } = setup()

    // When
    const result = dispatcher.dispatch({
      kind: "exec-server-message",
      message: {
        kind: "native",
        operation: "read",
        field: 7,
        id: 9,
        execId: "native-exec",
        payload: new Uint8Array(),
      },
    })

    // Then
    expect(result.outcome).toEqual({ kind: "native-rejected", operation: "read" })
    expect(result.closeStream).toBe(false)
    expect(reply(result.replyFrames[0] ?? new Uint8Array())).toMatchObject({
      kind: "exec-client-message",
      message: { kind: "native", operation: "read", id: 9, execId: "native-exec" },
    })
  })

  it("answers interaction queries and classifies controls and unknown stranding drift", () => {
    // Given
    const { dispatcher } = setup()

    // When
    const query = dispatcher.dispatch({
      kind: "interaction-query",
      query: { kind: "web-search", id: 11, payload: new Uint8Array() },
    })
    const control = dispatcher.dispatch({
      kind: "exec-server-control",
      control: { kind: "abort", id: 12 },
    })
    const drift = dispatcher.dispatch({
      kind: "unknown-oneof",
      field: 99,
      payload: new Uint8Array(),
      drift: { unknownFields: [], stranding: true },
    })

    // Then
    expect(query.outcome).toEqual({ kind: "interaction-replied", id: 11, action: "rejected" })
    expect(control.outcome).toEqual({ kind: "control", control: "abort", id: 12 })
    expect(drift.outcome).toEqual({
      kind: "drift",
      area: "server-message",
      detail: "field-99",
      stranding: true,
    })
    expect(dispatcher.parkedCalls.size).toBe(0)
  })

  it("rejects malformed wire input at the strict decode boundary", () => {
    // Given
    const { dispatcher } = setup()

    // When
    const dispatch = (): unknown => dispatcher.dispatchBytes(new Uint8Array([0x0a, 0x02, 0x01]))

    // Then
    expect(dispatch).toThrow(CursorProtocolError)
  })
})
