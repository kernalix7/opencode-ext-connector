import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { createCursorBlobStore } from "../../../../src/providers/cursor/blob-store"
import { createCursorCheckpointStore } from "../../../../src/providers/cursor/checkpoint-store"
import { decodeAgentClientMessage } from "../../../../src/providers/cursor/proto/request"
import { buildCursorAgentRunRequest } from "../../../../src/providers/cursor/request-build"
import { FakeClock } from "../../../support/clock"

const FIXTURE_ROOT = join(import.meta.dir, "../../../fixtures/cursor/pi-cursor/1.4.26")

function manifestValue(manifest: unknown, key: string): string {
  if (typeof manifest !== "object" || manifest === null) throw new Error("invalid fixture manifest")
  const value = Reflect.get(manifest, key)
  if (typeof value !== "string") throw new Error("invalid fixture manifest")
  return value
}

describe("pinned pi-cursor v1.4.26 request evidence", () => {
  it("verifies provenance hashes before decoding static AgentClientMessage bytes", () => {
    // Given
    const manifest: unknown = JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8"))
    const fixtureName = manifestValue(manifest, "fixture")
    const bytes = new Uint8Array(
      Buffer.from(readFileSync(join(FIXTURE_ROOT, fixtureName), "utf8").trim(), "base64"),
    )

    // When
    const hash = createHash("sha256").update(bytes).digest("hex")
    const message = decodeAgentClientMessage(bytes)

    // Then
    expect(hash).toBe(manifestValue(manifest, "fixtureSha256"))
    expect(manifestValue(manifest, "upstreamCommit")).toBe(
      "d80c12704a5136b441e6d86d1cbbd5f05d5fbcf6",
    )
    expect(manifestValue(manifest, "protoSha256")).toBe(
      "0760b83d6a9a5ad3911aaa00a345b71bd1147178b667917fd17e5826661af47c",
    )
    expect(message.kind).toBe("run-request")
    if (message.kind !== "run-request") throw new Error("expected run request fixture")
    expect(message.request.conversationId).toBe("fixture-conversation")
    expect(message.request.requestedModel).toEqual({
      modelId: "fixture-model",
      maxMode: true,
      parameters: [{ id: "reasoning", value: "high" }],
    })
    expect(message.request.action.kind).toBe("user-message")
    expect(message.request.conversationState.rootPromptMessageBlobIds).toEqual([
      Uint8Array.from([0xaa]),
    ])
  })

  it("builds the request fields evidenced by the pinned fixture", () => {
    // Given
    const clock = new FakeClock()
    const blobStore = createCursorBlobStore({
      clock,
      maxBytes: 100_000,
      maxEntries: 100,
      ttlMs: 1_000,
    })
    const checkpointStore = createCursorCheckpointStore({
      blobStore,
      clock,
      maxBytes: 10_000,
      maxEntries: 10,
      ttlMs: 1_000,
    })

    // When
    const built = buildCursorAgentRunRequest({
      blobStore,
      checkpointStore,
      createId: () => "00000000-0000-4000-8000-000000000001",
      input: {
        action: { kind: "user", text: "fixture-user", images: [] },
        conversationId: "fixture-conversation",
        history: [],
        maxMode: true,
        mcpTools: [],
        modelId: "fixture-model",
        mode: "fresh",
        modelParameters: [{ id: "reasoning", value: "high" }],
        rootSystemPrompt: "fixture-system",
      },
    })
    const message = decodeAgentClientMessage(built.bytes)

    // Then
    expect(message.kind).toBe("run-request")
    if (message.kind !== "run-request") throw new Error("expected built run request")
    expect(message.request.conversationId).toBe("fixture-conversation")
    expect(message.request.requestedModel).toEqual({
      modelId: "fixture-model",
      maxMode: true,
      parameters: [{ id: "reasoning", value: "high" }],
    })
    expect(message.request.action.kind).toBe("user-message")
    built.ownership.release()
  })
})
