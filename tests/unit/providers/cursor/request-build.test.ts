import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import { InvalidArgumentError } from "../../../../src/core/errors"
import {
  type CursorBlobStore,
  createCursorBlobStore,
} from "../../../../src/providers/cursor/blob-store"
import {
  type CursorCheckpointStore,
  createCursorCheckpointStore,
} from "../../../../src/providers/cursor/checkpoint-store"
import { decodeAgentClientMessage } from "../../../../src/providers/cursor/proto/request"
import {
  buildCursorAgentRunRequest,
  normalizeCursorRootPrompt,
} from "../../../../src/providers/cursor/request-build"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

type Stores = {
  readonly blobs: CursorBlobStore
  readonly checkpoints: CursorCheckpointStore
  readonly clock: FakeClock
}

function stores(ttlMs = 1_000): Stores {
  const clock = new FakeClock()
  const blobs = createCursorBlobStore({ clock, maxBytes: 1_000_000, maxEntries: 100, ttlMs })
  return {
    blobs,
    checkpoints: createCursorCheckpointStore({
      blobStore: blobs,
      clock,
      maxBytes: 10_000,
      maxEntries: 10,
      ttlMs,
    }),
    clock,
  }
}

function ids(): () => string {
  let next = 0
  return (): string => `id-${++next}`
}

const BASE = {
  action: { kind: "user", text: "next", images: [], selectedContext: ["src/a.ts"] },
  conversationId: "conversation-1",
  history: [],
  mcpTools: [],
  modelId: "cursor-model",
  mode: "fresh",
  modelParameters: [{ id: "reasoning", value: "high" }],
  rootSystemPrompt: "  rules\r\n  ",
} as const

function decodedRequest(bytes: Uint8Array) {
  const message = decodeAgentClientMessage(bytes)
  expect(message.kind).toBe("run-request")
  if (message.kind !== "run-request") throw new Error("expected run request")
  return message.request
}

describe("Cursor AgentRun request construction", () => {
  it("builds pinned fresh shape with full structured history and blob references", () => {
    // Given
    const state = stores()
    const image = Uint8Array.from([0xde, 0xad])
    const input = {
      ...BASE,
      action: { ...BASE.action, images: [{ data: image, mimeType: "image/png" }] },
      history: [
        {
          user: { text: "inspect", images: [] },
          steps: [
            { kind: "assistant", text: "checking" },
            {
              kind: "tool",
              arguments: { path: "src/a.ts" },
              result: { kind: "success", content: [{ kind: "text", text: "ok" }] },
              toolCallId: "call-1",
              toolName: "read",
            },
          ],
        },
      ],
    }

    // When
    const built = buildCursorAgentRunRequest({
      blobStore: state.blobs,
      checkpointStore: state.checkpoints,
      createId: ids(),
      input,
    })
    const request = decodedRequest(built.bytes)

    // Then
    expect(built.kind).toBe("fresh")
    expect(request.conversationId).toBe("conversation-1")
    expect(request.requestedModel).toEqual({
      modelId: "cursor-model",
      maxMode: false,
      parameters: [{ id: "reasoning", value: "high" }],
    })
    expect(request.action.kind).toBe("user-message")
    expect(request.conversationState.turnBlobIds).toHaveLength(1)
    expect(request.conversationState.rootPromptMessageBlobIds.length).toBeGreaterThan(2)
    expect(built.blobIds.every((blobId) => state.blobs.has(blobId))).toBe(true)
    expect(built.blobIds).toContain(state.blobs.hash(image))
  })

  it("uses the latest checkpoint without duplicating prior history", () => {
    // Given
    const state = stores()
    const sessionId = parseCursorSessionId("session-1")
    const checkpoint = Uint8Array.from([
      0x4a,
      0x01,
      0x01,
      0xb2,
      0x01,
      0x08,
      ...new TextEncoder().encode("opencode"),
    ])
    expect(state.checkpoints.update({ sessionId, bytes: checkpoint })).toBe(true)

    // When
    const built = buildCursorAgentRunRequest({
      blobStore: state.blobs,
      checkpointStore: state.checkpoints,
      createId: ids(),
      input: {
        ...BASE,
        mode: "checkpoint",
        sessionId,
        history: [{ user: { text: "old", images: [] }, steps: [] }],
      },
    })
    const request = decodedRequest(built.bytes)

    // Then
    expect(built.kind).toBe("checkpoint")
    expect(request.conversationState.turnBlobIds).toEqual([])
    expect(request.conversationState.previousWorkspaceUris).toEqual(["\u0001"])
    expect(request.action.kind).toBe("user-message")
  })

  it("emits pinned Resume and Cancel action discriminants only with a checkpoint", () => {
    // Given
    const state = stores()
    const sessionId = parseCursorSessionId("session-2")
    const checkpoint = Uint8Array.from([0xb2, 0x01, 0x08, ...new TextEncoder().encode("opencode")])
    expect(state.checkpoints.update({ sessionId, bytes: checkpoint })).toBe(true)

    // When
    const resume = buildCursorAgentRunRequest({
      blobStore: state.blobs,
      checkpointStore: state.checkpoints,
      createId: ids(),
      input: { ...BASE, action: { kind: "resume" }, mode: "checkpoint", sessionId },
    })
    const cancel = buildCursorAgentRunRequest({
      blobStore: state.blobs,
      checkpointStore: state.checkpoints,
      createId: ids(),
      input: { ...BASE, action: { kind: "cancel" }, mode: "checkpoint", sessionId },
    })

    // Then
    expect(decodedRequest(resume.bytes).action.kind).toBe("resume")
    expect(decodedRequest(cancel.bytes).action.kind).toBe("cancel")
  })

  it("normalizes root prompts structurally and content-addresses the result", () => {
    // Given
    const equivalent = [" rules\r\n", "rules\n"]

    // When
    const normalized = equivalent.map(normalizeCursorRootPrompt)
    const hashes = normalized.map((value) => createHash("sha256").update(value).digest("hex"))

    // Then
    expect(normalized[0]).toEqual(normalized[1])
    expect(hashes[0]).toBe(hashes[1])
    expect(JSON.parse(new TextDecoder().decode(normalized[0]))).toMatchObject({ role: "user" })
  })

  it("matches the pinned v1.4.26 AgentClientMessage descriptor fixture", () => {
    // Given
    const state = stores()

    // When
    const built = buildCursorAgentRunRequest({
      blobStore: state.blobs,
      checkpointStore: state.checkpoints,
      createId: ids(),
      input: BASE,
    })

    // Then
    expect(createHash("sha256").update(built.bytes).digest("hex")).toBe(
      "b6b2512b589c6180032f2e0a524125b943be1d3c90aa21be48c7ef44edf8fc42",
    )
  })

  it("appends normalized instructions when checkpoint prompt state is stale", () => {
    // Given
    const state = stores()
    const sessionId = parseCursorSessionId("session-refresh")
    const checkpoint = Uint8Array.from([
      0x0a,
      0x01,
      0xaa,
      0xb2,
      0x01,
      0x08,
      ...new TextEncoder().encode("opencode"),
    ])
    expect(state.checkpoints.update({ sessionId, bytes: checkpoint })).toBe(true)

    // When
    const built = buildCursorAgentRunRequest({
      blobStore: state.blobs,
      checkpointStore: state.checkpoints,
      createId: ids(),
      input: { ...BASE, mode: "checkpoint", sessionId, refreshRootPrompt: true },
    })

    // Then
    const rootIds = decodedRequest(built.bytes).conversationState.rootPromptMessageBlobIds
    expect(rootIds).toHaveLength(2)
    expect(rootIds.at(0)).toEqual(Uint8Array.from([0xaa]))
  })

  it("rejects malformed input, missing checkpoints, and stale checkpoint state", () => {
    // Given
    const state = stores(10)
    const sessionId = parseCursorSessionId("session-stale")
    const checkpoint = Uint8Array.from([0xb2, 0x01, 0x08, ...new TextEncoder().encode("opencode")])
    expect(state.checkpoints.update({ sessionId, bytes: checkpoint })).toBe(true)
    state.clock.advanceBy(10)

    // When
    const malformed = () =>
      buildCursorAgentRunRequest({
        blobStore: state.blobs,
        checkpointStore: state.checkpoints,
        createId: ids(),
        input: { ...BASE, modelId: "" },
      })
    const missing = () =>
      buildCursorAgentRunRequest({
        blobStore: state.blobs,
        checkpointStore: state.checkpoints,
        createId: ids(),
        input: { ...BASE, mode: "checkpoint", sessionId },
      })

    // Then
    expect(malformed).toThrow()
    expect(missing).toThrow(InvalidArgumentError)
  })
})
