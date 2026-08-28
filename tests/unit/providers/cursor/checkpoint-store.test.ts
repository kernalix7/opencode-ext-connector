import { describe, expect, it } from "bun:test"

import { InvalidArgumentError } from "../../../../src/core/errors"
import { createCursorBlobStore } from "../../../../src/providers/cursor/blob-store"
import { createCursorCheckpointStore } from "../../../../src/providers/cursor/checkpoint-store"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

describe("createCursorCheckpointStore", () => {
  it("updates and resumes an immutable checkpoint for its session", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 2, ttlMs: 20 })
    const checkpoints = createCursorCheckpointStore({
      blobStore: blobs,
      clock,
      maxBytes: 32,
      maxEntries: 2,
      ttlMs: 20,
    })
    const session = parseCursorSessionId("session-a")
    const checkpoint = new Uint8Array([1, 2])

    // When
    const stored = checkpoints.update({ bytes: checkpoint, sessionId: session })
    checkpoint[0] = 0
    const resumed = checkpoints.resume(session)
    if (resumed !== null) {
      resumed.bytes[1] = 0
    }

    // Then
    expect(stored).toBe(true)
    expect(checkpoints.resume(session)?.bytes).toEqual(new Uint8Array([1, 2]))
  })

  it("invalidates only the checkpoint whose referenced blob is missing", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 2, ttlMs: 20 })
    const checkpoints = createCursorCheckpointStore({
      blobStore: blobs,
      clock,
      maxBytes: 32,
      maxEntries: 2,
      ttlMs: 20,
    })
    const sharedBlob = blobs.put(new Uint8Array([7]))
    const missingBlob = blobs.hash(new Uint8Array([8]))
    const firstSession = parseCursorSessionId("session-a")
    const secondSession = parseCursorSessionId("session-b")
    if (sharedBlob === null) {
      throw new Error("fixture blob must fit")
    }
    checkpoints.update({
      bytes: new Uint8Array([1]),
      blobIds: [missingBlob],
      sessionId: firstSession,
    })
    checkpoints.update({
      bytes: new Uint8Array([2]),
      blobIds: [sharedBlob],
      sessionId: secondSession,
    })

    // When
    const missed = checkpoints.resume(firstSession)
    const resumed = checkpoints.resume(secondSession)

    // Then
    expect(missed).toBeNull()
    expect(checkpoints.resume(firstSession)).toBeNull()
    expect(resumed?.bytes).toEqual(new Uint8Array([2]))
  })

  it("expires checkpoints and evicts the least-recently-used entry at its count bound", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 2, ttlMs: 10 })
    const checkpoints = createCursorCheckpointStore({
      blobStore: blobs,
      clock,
      maxBytes: 32,
      maxEntries: 1,
      ttlMs: 10,
    })
    const firstSession = parseCursorSessionId("session-a")
    const secondSession = parseCursorSessionId("session-b")
    checkpoints.update({ bytes: new Uint8Array([1]), sessionId: firstSession })

    // When
    checkpoints.update({ bytes: new Uint8Array([2]), sessionId: secondSession })
    clock.advanceBy(10)
    const expired = checkpoints.resume(secondSession)

    // Then
    expect(checkpoints.resume(firstSession)).toBeNull()
    expect(expired).toBeNull()
  })

  it("does not resume a checkpoint from a cancelled session", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 2, ttlMs: 20 })
    const checkpoints = createCursorCheckpointStore({
      blobStore: blobs,
      clock,
      maxBytes: 32,
      maxEntries: 2,
      ttlMs: 20,
    })
    const session = parseCursorSessionId("session-a")
    checkpoints.update({ bytes: new Uint8Array([1]), sessionId: session })

    checkpoints.invalidate(session)

    // When
    const resumed = checkpoints.resume(session)

    // Then
    expect(resumed).toBeNull()
  })

  it("retains a shared pinned blob until every checkpoint releases it", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 1, maxEntries: 1, ttlMs: 20 })
    const checkpoints = createCursorCheckpointStore({
      blobStore: blobs,
      clock,
      maxBlobReferences: 1,
      maxBytes: 32,
      maxEntries: 2,
      ttlMs: 20,
    })
    const shared = blobs.put(new Uint8Array([1]))
    if (shared === null) {
      throw new Error("fixture blob must fit")
    }
    const firstSession = parseCursorSessionId("session-a")
    const secondSession = parseCursorSessionId("session-b")
    checkpoints.update({ bytes: new Uint8Array([1]), blobIds: [shared], sessionId: firstSession })
    checkpoints.update({ bytes: new Uint8Array([2]), blobIds: [shared], sessionId: secondSession })

    // When
    checkpoints.invalidate(firstSession)
    const whileShared = blobs.put(new Uint8Array([2]))
    checkpoints.invalidate(secondSession)
    const afterRelease = blobs.put(new Uint8Array([2]))

    // Then
    expect(whileShared).toBeNull()
    expect(afterRelease).not.toBeNull()
  })

  it("rejects invalid bounds and checkpoint reference metadata beyond its cap", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 2, ttlMs: 20 })
    const first = blobs.put(new Uint8Array([1]))
    const second = blobs.put(new Uint8Array([2]))
    if (first === null || second === null) {
      throw new Error("fixture blobs must fit")
    }
    const session = parseCursorSessionId("session-a")
    const checkpoints = createCursorCheckpointStore({
      blobStore: blobs,
      clock,
      maxBlobReferences: 1,
      maxBytes: 32,
      maxEntries: 1,
      ttlMs: 20,
    })

    // When
    const stored = checkpoints.update({
      bytes: new Uint8Array([1]),
      blobIds: [first, second],
      sessionId: session,
    })

    // Then
    expect(() =>
      createCursorCheckpointStore({
        blobStore: blobs,
        clock,
        maxBytes: 32,
        maxEntries: 1,
        ttlMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(InvalidArgumentError)
    expect(stored).toBe(false)
    expect(checkpoints.resume(session)).toBeNull()
  })

  it("releases replaced and expired checkpoint references without pin leaks", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 2, maxEntries: 2, ttlMs: 20 })
    const first = blobs.put(new Uint8Array([1]))
    const second = blobs.put(new Uint8Array([2]))
    if (first === null || second === null) {
      throw new Error("fixture blobs must fit")
    }
    const checkpoints = createCursorCheckpointStore({
      blobStore: blobs,
      clock,
      maxBlobReferences: 1,
      maxBytes: 32,
      maxEntries: 1,
      ttlMs: 10,
    })
    const session = parseCursorSessionId("session-a")
    checkpoints.update({ bytes: new Uint8Array([1]), blobIds: [first], sessionId: session })

    // When
    checkpoints.update({ bytes: new Uint8Array([2]), blobIds: [second], sessionId: session })
    const afterReplacement = blobs.put(new Uint8Array([3]))
    clock.advanceBy(10)
    checkpoints.size()
    const afterExpiry = blobs.put(new Uint8Array([4]))

    // Then
    expect(afterReplacement).not.toBeNull()
    expect(afterExpiry).not.toBeNull()
    expect(blobs.get(second)).toBeNull()
  })
})
