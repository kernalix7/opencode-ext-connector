import { describe, expect, it } from "bun:test"

import { InvalidArgumentError } from "../../../../src/core/errors"
import { createCursorBlobStore } from "../../../../src/providers/cursor/blob-store"
import {
  createCursorSessionStateStore,
  parseCursorSessionId,
} from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

describe("createCursorSessionStateStore", () => {
  it("isolates session keys while safely sharing immutable content-addressed blobs", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 2, ttlMs: 20 })
    const states = createCursorSessionStateStore({
      blobStore: blobs,
      clock,
      maxKeysPerSession: 2,
      maxSessions: 2,
      ttlMs: 20,
    })
    const firstSession = parseCursorSessionId("session-a")
    const secondSession = parseCursorSessionId("session-b")
    const firstValue = new Uint8Array([1, 2])

    // When
    const firstBlob = states.set(firstSession, "cursor.kv", firstValue)
    const secondBlob = states.set(secondSession, "cursor.kv", new Uint8Array([1, 2]))
    firstValue[0] = 0
    const read = states.get(firstSession, "cursor.kv")
    if (read !== null) {
      read[1] = 0
    }
    states.set(firstSession, "cursor.kv", new Uint8Array([3]))

    // Then
    expect(firstBlob).toBe(secondBlob)
    expect(states.get(firstSession, "cursor.kv")).toEqual(new Uint8Array([3]))
    expect(states.get(secondSession, "cursor.kv")).toEqual(new Uint8Array([1, 2]))
  })

  it("expires stale sessions before deterministic least-recently-used session eviction", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 4, ttlMs: 10 })
    const states = createCursorSessionStateStore({
      blobStore: blobs,
      clock,
      maxKeysPerSession: 1,
      maxSessions: 2,
      ttlMs: 10,
    })
    const firstSession = parseCursorSessionId("session-a")
    const secondSession = parseCursorSessionId("session-b")
    const thirdSession = parseCursorSessionId("session-c")
    states.set(firstSession, "one", new Uint8Array([1]))
    clock.advanceBy(5)
    states.set(secondSession, "one", new Uint8Array([2]))
    clock.advanceBy(6)

    // When
    states.set(thirdSession, "one", new Uint8Array([3]))
    states.set(secondSession, "two", new Uint8Array([4]))

    // Then
    expect(states.get(firstSession, "one")).toBeNull()
    expect(states.get(secondSession, "one")).toBeNull()
    expect(states.get(secondSession, "two")).toEqual(new Uint8Array([4]))
    expect(states.get(thirdSession, "one")).toEqual(new Uint8Array([3]))
  })

  it("keeps a shared pinned KV blob until every session releases it", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 1, maxEntries: 1, ttlMs: 20 })
    const states = createCursorSessionStateStore({
      blobStore: blobs,
      clock,
      maxKeysPerSession: 1,
      maxSessions: 2,
      ttlMs: 20,
    })
    const firstSession = parseCursorSessionId("session-a")
    const secondSession = parseCursorSessionId("session-b")
    states.set(firstSession, "one", new Uint8Array([1]))
    states.set(secondSession, "one", new Uint8Array([1]))

    // When
    states.invalidate(firstSession)
    const whileShared = blobs.put(new Uint8Array([2]))
    states.invalidate(secondSession)
    const afterRelease = blobs.put(new Uint8Array([2]))

    // Then
    expect(whileShared).toBeNull()
    expect(afterRelease).not.toBeNull()
  })

  it("releases an evicted key reference and rejects malformed bounds", () => {
    // Given
    const clock = new FakeClock()
    const blobs = createCursorBlobStore({ clock, maxBytes: 2, maxEntries: 2, ttlMs: 20 })
    const states = createCursorSessionStateStore({
      blobStore: blobs,
      clock,
      maxKeysPerSession: 1,
      maxSessions: 1,
      ttlMs: 20,
    })
    const session = parseCursorSessionId("session-a")
    states.set(session, "one", new Uint8Array([1]))

    // When
    states.set(session, "two", new Uint8Array([2]))
    const third = blobs.put(new Uint8Array([3]))

    // Then
    expect(() =>
      createCursorSessionStateStore({
        blobStore: blobs,
        clock,
        maxKeysPerSession: 1,
        maxSessions: -1,
        ttlMs: 20,
      }),
    ).toThrow(InvalidArgumentError)
    expect(states.get(session, "one")).toBeNull()
    expect(third).not.toBeNull()
  })
})
