import type { Clock } from "../../core/clock"
import {
  type CursorBlobId,
  type CursorBlobStore,
  requireCursorStoreTtl,
  requirePositiveCursorStoreBound,
} from "./blob-store"
import type { CursorSessionId } from "./session-state"

export type CursorCheckpoint = {
  readonly blobIds: readonly CursorBlobId[]
  readonly bytes: Uint8Array
}

export type CursorCheckpointUpdate = {
  readonly blobIds?: readonly CursorBlobId[]
  readonly bytes: Uint8Array
  readonly sessionId: CursorSessionId
}

export type CursorCheckpointStoreOptions = {
  readonly blobStore: CursorBlobStore
  readonly clock: Clock
  readonly maxBlobReferences?: number
  readonly maxBytes: number
  readonly maxEntries: number
  /** Logical milliseconds; zero expires checkpoints on the next store operation. */
  readonly ttlMs: number
}

export type CursorCheckpointStore = {
  readonly invalidate: (sessionId: CursorSessionId) => void
  readonly resume: (sessionId: CursorSessionId) => CursorCheckpoint | null
  readonly size: () => number
  readonly update: (checkpoint: CursorCheckpointUpdate) => boolean
}

type CheckpointEntry = CursorCheckpoint & {
  readonly lastAccessMs: number
}

export function createCursorCheckpointStore(
  options: CursorCheckpointStoreOptions,
): CursorCheckpointStore {
  const maxBlobReferences = options.maxBlobReferences ?? 64
  requirePositiveCursorStoreBound(maxBlobReferences, "maxBlobReferences")
  requirePositiveCursorStoreBound(options.maxBytes, "maxBytes")
  requirePositiveCursorStoreBound(options.maxEntries, "maxEntries")
  requireCursorStoreTtl(options.ttlMs)
  const entries = new Map<CursorSessionId, CheckpointEntry>()
  let totalBytes = 0

  const release = (entry: CheckpointEntry): void => {
    for (const blobId of entry.blobIds) {
      options.blobStore.release(blobId)
    }
  }

  const remove = (sessionId: CursorSessionId): void => {
    const entry = entries.get(sessionId)
    if (entry !== undefined) {
      entries.delete(sessionId)
      totalBytes -= entry.bytes.byteLength
      release(entry)
    }
  }

  const evictExpired = (nowMs: number): void => {
    for (const [sessionId, entry] of entries) {
      if (nowMs - entry.lastAccessMs >= options.ttlMs) {
        remove(sessionId)
      }
    }
  }

  const evictToBounds = (): void => {
    while (entries.size > options.maxEntries || totalBytes > options.maxBytes) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) {
        return
      }
      remove(oldest)
    }
  }

  const insert = (sessionId: CursorSessionId, entry: CheckpointEntry): void => {
    remove(sessionId)
    entries.set(sessionId, entry)
    totalBytes += entry.bytes.byteLength
  }

  const invalidate = remove

  return {
    invalidate,
    resume: (sessionId): CursorCheckpoint | null => {
      const nowMs = options.clock.nowMs()
      evictExpired(nowMs)
      const entry = entries.get(sessionId)
      if (entry === undefined) {
        return null
      }
      for (const blobId of entry.blobIds) {
        if (!options.blobStore.has(blobId)) {
          invalidate(sessionId)
          return null
        }
      }
      entries.delete(sessionId)
      entries.set(sessionId, { ...entry, lastAccessMs: nowMs })
      return { blobIds: [...entry.blobIds], bytes: new Uint8Array(entry.bytes) }
    },
    size: (): number => {
      evictExpired(options.clock.nowMs())
      return entries.size
    },
    update: (checkpoint): boolean => {
      const nowMs = options.clock.nowMs()
      evictExpired(nowMs)
      const blobIds = checkpoint.blobIds ?? []
      if (checkpoint.bytes.byteLength > options.maxBytes || blobIds.length > maxBlobReferences) {
        return false
      }
      const pinned: CursorBlobId[] = []
      for (const blobId of blobIds) {
        if (!options.blobStore.pin(blobId)) {
          for (const pinnedId of pinned) {
            options.blobStore.release(pinnedId)
          }
          return false
        }
        pinned.push(blobId)
      }
      insert(checkpoint.sessionId, {
        blobIds: [...blobIds],
        bytes: new Uint8Array(checkpoint.bytes),
        lastAccessMs: nowMs,
      })
      evictToBounds()
      return entries.has(checkpoint.sessionId)
    },
  }
}
