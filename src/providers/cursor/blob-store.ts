import { createHash } from "node:crypto"

import { z } from "zod"

import type { Clock } from "../../core/clock.js"
import { InvalidArgumentError } from "../../core/errors.js"

export const CursorBlobIdSchema: z.core.$ZodBranded<z.ZodString, "CursorBlobId"> = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"CursorBlobId">()

export type CursorBlobId = z.output<typeof CursorBlobIdSchema>

export type CursorBlobStoreOptions = {
  readonly clock: Clock
  readonly maxBytes: number
  readonly maxEntries: number
  /** Logical milliseconds; zero expires content on the next store operation. */
  readonly ttlMs: number
}

export type CursorBlobStore = {
  readonly get: (blobId: CursorBlobId) => Uint8Array | null
  readonly has: (blobId: CursorBlobId) => boolean
  readonly hash: (bytes: Uint8Array) => CursorBlobId
  readonly pin: (blobId: CursorBlobId) => boolean
  readonly put: (bytes: Uint8Array) => CursorBlobId | null
  readonly putVerified: (blobId: CursorBlobId, bytes: Uint8Array) => CursorBlobId | null
  readonly release: (blobId: CursorBlobId) => void
  readonly size: () => number
}

type BlobEntry = {
  readonly bytes: Uint8Array
  readonly lastAccessMs: number
  pins: number
}

export function hashCursorBlob(bytes: Uint8Array): CursorBlobId {
  return CursorBlobIdSchema.parse(createHash("sha256").update(bytes).digest("hex"))
}

export function parseCursorWireBlobId(bytes: Uint8Array): CursorBlobId {
  if (bytes.byteLength !== 32) {
    throw new InvalidArgumentError("blobId")
  }
  return CursorBlobIdSchema.parse(Buffer.from(bytes).toString("hex"))
}

export function requirePositiveCursorStoreBound(value: number, argument: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidArgumentError(argument)
  }
}

export function requireCursorStoreTtl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidArgumentError("ttlMs")
  }
}

export function createCursorBlobStore(options: CursorBlobStoreOptions): CursorBlobStore {
  requirePositiveCursorStoreBound(options.maxBytes, "maxBytes")
  requirePositiveCursorStoreBound(options.maxEntries, "maxEntries")
  requireCursorStoreTtl(options.ttlMs)
  const entries = new Map<CursorBlobId, BlobEntry>()
  let totalBytes = 0

  const evictExpired = (nowMs: number): void => {
    for (const [blobId, entry] of entries) {
      if (entry.pins === 0 && nowMs - entry.lastAccessMs >= options.ttlMs) {
        entries.delete(blobId)
        totalBytes -= entry.bytes.byteLength
      }
    }
  }

  const evictToBounds = (): void => {
    while (entries.size > options.maxEntries || totalBytes > options.maxBytes) {
      let evicted = false
      for (const [blobId, entry] of entries) {
        if (entry.pins === 0) {
          entries.delete(blobId)
          totalBytes -= entry.bytes.byteLength
          evicted = true
          break
        }
      }
      if (!evicted) {
        return
      }
    }
  }

  const touch = (blobId: CursorBlobId, entry: BlobEntry, nowMs: number): BlobEntry => {
    const updated = { bytes: entry.bytes, lastAccessMs: nowMs, pins: entry.pins }
    entries.delete(blobId)
    entries.set(blobId, updated)
    return updated
  }

  const activeEntry = (blobId: CursorBlobId): BlobEntry | null => {
    const nowMs = options.clock.nowMs()
    evictExpired(nowMs)
    const entry = entries.get(blobId)
    return entry === undefined ? null : touch(blobId, entry, nowMs)
  }

  const store = (blobId: CursorBlobId, bytes: Uint8Array): CursorBlobId | null => {
    const nowMs = options.clock.nowMs()
    evictExpired(nowMs)
    if (bytes.byteLength > options.maxBytes) {
      return null
    }
    const existing = entries.get(blobId)
    if (existing !== undefined) {
      touch(blobId, existing, nowMs)
      return blobId
    }
    const snapshot = new Uint8Array(bytes)
    entries.set(blobId, { bytes: snapshot, lastAccessMs: nowMs, pins: 0 })
    totalBytes += snapshot.byteLength
    evictToBounds()
    return entries.has(blobId) ? blobId : null
  }

  return {
    get: (blobId): Uint8Array | null => {
      const entry = activeEntry(blobId)
      return entry === null ? null : new Uint8Array(entry.bytes)
    },
    has: (blobId): boolean => activeEntry(blobId) !== null,
    hash: hashCursorBlob,
    pin: (blobId): boolean => {
      const entry = activeEntry(blobId)
      if (entry === null) {
        return false
      }
      entry.pins += 1
      return true
    },
    put: (bytes): CursorBlobId | null => store(hashCursorBlob(bytes), bytes),
    putVerified: (blobId, bytes): CursorBlobId | null => {
      if (hashCursorBlob(bytes) !== blobId) {
        throw new InvalidArgumentError("blobId")
      }
      return store(blobId, bytes)
    },
    release: (blobId): void => {
      const entry = entries.get(blobId)
      if (entry !== undefined && entry.pins > 0) {
        entry.pins -= 1
      }
    },
    size: (): number => {
      evictExpired(options.clock.nowMs())
      return entries.size
    },
  }
}
