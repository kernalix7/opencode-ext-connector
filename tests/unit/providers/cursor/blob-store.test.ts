import { describe, expect, it } from "bun:test"

import { InvalidArgumentError } from "../../../../src/core/errors"
import {
  createCursorBlobStore,
  hashCursorBlob,
  parseCursorWireBlobId,
} from "../../../../src/providers/cursor/blob-store"
import { FakeClock } from "../../../support/clock"

describe("createCursorBlobStore", () => {
  it("hashes bytes with deterministic SHA-256 hex and returns immutable snapshots", () => {
    // Given
    const clock = new FakeClock()
    const store = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 2, ttlMs: 10 })
    const source = new Uint8Array([97, 98, 99])

    // When
    const blobId = store.put(source)
    source[0] = 0
    const first = blobId === null ? null : store.get(blobId)
    if (first !== null) {
      first[1] = 0
    }
    const second = blobId === null ? null : store.get(blobId)

    // Then
    expect(String(hashCursorBlob(new Uint8Array([97, 98, 99])))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
    expect(blobId).toBe(hashCursorBlob(new Uint8Array([97, 98, 99])))
    expect(second).toEqual(new Uint8Array([97, 98, 99]))
  })

  it("evicts expired blobs before applying deterministic least-recently-used bounds", () => {
    // Given
    const clock = new FakeClock()
    const store = createCursorBlobStore({ clock, maxBytes: 4, maxEntries: 2, ttlMs: 10 })
    const first = store.put(new Uint8Array([1]))
    clock.advanceBy(5)
    const second = store.put(new Uint8Array([2]))
    clock.advanceBy(6)

    // When
    const third = store.put(new Uint8Array([3]))
    const fourth = store.put(new Uint8Array([4]))

    // Then
    expect(first === null ? null : store.get(first)).toBeNull()
    expect(second === null ? null : store.get(second)).toBeNull()
    expect(third === null ? null : store.get(third)).toEqual(new Uint8Array([3]))
    expect(fourth === null ? null : store.get(fourth)).toEqual(new Uint8Array([4]))
  })

  it("reports an oversized blob as absent instead of accepting an unresumable value", () => {
    // Given
    const clock = new FakeClock()
    const store = createCursorBlobStore({ clock, maxBytes: 1, maxEntries: 1, ttlMs: 10 })

    // When
    const blobId = store.put(new Uint8Array([1, 2]))

    // Then
    expect(blobId).toBeNull()
    expect(store.size()).toBe(0)
  })

  it("rejects non-safe bounds while accepting zero TTL as immediate logical expiry", () => {
    // Given
    const clock = new FakeClock()

    // When
    const immediate = createCursorBlobStore({ clock, maxBytes: 1, maxEntries: 1, ttlMs: 0 })

    // Then
    expect(() =>
      createCursorBlobStore({ clock, maxBytes: Number.NaN, maxEntries: 1, ttlMs: 1 }),
    ).toThrow(InvalidArgumentError)
    expect(() => createCursorBlobStore({ clock, maxBytes: 1, maxEntries: 0, ttlMs: 1 })).toThrow(
      InvalidArgumentError,
    )
    expect(() => createCursorBlobStore({ clock, maxBytes: 1, maxEntries: 1, ttlMs: -1 })).toThrow(
      InvalidArgumentError,
    )
    expect(immediate.put(new Uint8Array([1]))).not.toBeNull()
    expect(immediate.size()).toBe(0)
  })

  it("parses wire IDs and rejects content whose SHA-256 does not match its supplied ID", () => {
    // Given
    const clock = new FakeClock()
    const store = createCursorBlobStore({ clock, maxBytes: 32, maxEntries: 2, ttlMs: 10 })
    const wireId = parseCursorWireBlobId(new Uint8Array(32).fill(1))

    // When
    const mismatched = (): void => {
      store.putVerified(wireId, new Uint8Array([1]))
    }

    // Then
    expect(String(wireId)).toBe("01".repeat(32))
    expect(() => parseCursorWireBlobId(new Uint8Array(31))).toThrow(InvalidArgumentError)
    expect(mismatched).toThrow(InvalidArgumentError)
    expect(store.get(wireId)).toBeNull()
  })
})
