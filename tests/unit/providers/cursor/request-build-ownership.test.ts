import { describe, expect, it } from "bun:test"

import type { CursorBlobId, CursorBlobStore } from "../../../../src/providers/cursor/blob-store"
import { createCursorBlobStore } from "../../../../src/providers/cursor/blob-store"
import { createCursorCheckpointStore } from "../../../../src/providers/cursor/checkpoint-store"
import { buildCursorAgentRunRequest } from "../../../../src/providers/cursor/request-build"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

const INPUT = {
  action: { kind: "user", text: "next", images: [] },
  conversationId: "owned-conversation",
  history: [],
  mcpTools: [],
  modelId: "owned-model",
  mode: "fresh",
  modelParameters: [],
  rootSystemPrompt: "rules",
} as const

function trackedStore(options?: { readonly maxBytes?: number; readonly maxEntries?: number }): {
  readonly store: CursorBlobStore
  readonly clock: FakeClock
  readonly pinCalls: CursorBlobId[]
  readonly releaseCalls: CursorBlobId[]
} {
  const clock = new FakeClock()
  const base = createCursorBlobStore({
    clock,
    maxBytes: options?.maxBytes ?? 100_000,
    maxEntries: options?.maxEntries ?? 100,
    ttlMs: 1,
  })
  const pinCalls: CursorBlobId[] = []
  const releaseCalls: CursorBlobId[] = []
  return {
    clock,
    pinCalls,
    releaseCalls,
    store: {
      ...base,
      pin: (blobId): boolean => {
        pinCalls.push(blobId)
        return base.pin(blobId)
      },
      release: (blobId): void => {
        releaseCalls.push(blobId)
        base.release(blobId)
      },
    },
  }
}

function checkpoints(store: CursorBlobStore, clock: FakeClock) {
  return createCursorCheckpointStore({
    blobStore: store,
    clock,
    maxBytes: 10_000,
    maxEntries: 10,
    ttlMs: 1,
  })
}

describe("Cursor request blob ownership", () => {
  it("keeps every request blob alive under expiry and eviction pressure", () => {
    // Given
    const tracked = trackedStore({ maxEntries: 3 })
    const checkpointStore = checkpoints(tracked.store, tracked.clock)

    // When
    const built = buildCursorAgentRunRequest({
      blobStore: tracked.store,
      checkpointStore,
      createId: () => "owned-id",
      input: INPUT,
    })
    tracked.clock.advanceBy(1)
    for (let index = 0; index < 8; index += 1) tracked.store.put(Uint8Array.from([index]))

    // Then
    expect(built.ownership.blobIds).toEqual(built.blobIds)
    expect(built.blobIds.every((blobId) => tracked.store.has(blobId))).toBe(true)
  })

  it("releases each owned pin exactly once", () => {
    // Given
    const tracked = trackedStore()
    const built = buildCursorAgentRunRequest({
      blobStore: tracked.store,
      checkpointStore: checkpoints(tracked.store, tracked.clock),
      createId: () => "owned-id",
      input: INPUT,
    })

    // When
    built.ownership.release()
    built.ownership.release()
    built.ownership[Symbol.dispose]()

    // Then
    expect(tracked.releaseCalls).toEqual([...built.blobIds])
  })

  it("rolls back pins on partial build failure and does not pin malformed or stale input", () => {
    // Given
    const constrained = trackedStore({ maxBytes: 80 })
    const stale = trackedStore()
    const staleCheckpoints = checkpoints(stale.store, stale.clock)
    const sessionId = parseCursorSessionId("stale-session")
    stale.clock.advanceBy(1)

    // When
    const partial = () =>
      buildCursorAgentRunRequest({
        blobStore: constrained.store,
        checkpointStore: checkpoints(constrained.store, constrained.clock),
        createId: () => "owned-id",
        input: { ...INPUT, rootSystemPrompt: "x".repeat(70) },
      })
    const malformed = () =>
      buildCursorAgentRunRequest({
        blobStore: stale.store,
        checkpointStore: staleCheckpoints,
        createId: () => "owned-id",
        input: { ...INPUT, modelId: "" },
      })
    const missing = () =>
      buildCursorAgentRunRequest({
        blobStore: stale.store,
        checkpointStore: staleCheckpoints,
        createId: () => "owned-id",
        input: { ...INPUT, mode: "checkpoint", sessionId },
      })

    // Then
    expect(partial).toThrow()
    expect(constrained.releaseCalls).toEqual(constrained.pinCalls)
    expect(malformed).toThrow()
    expect(missing).toThrow()
    expect(stale.pinCalls).toEqual([])
    expect(stale.releaseCalls).toEqual([])
  })
})
