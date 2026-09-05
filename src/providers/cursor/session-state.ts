import { z } from "zod"

import type { Clock } from "../../core/clock.js"
import {
  type CursorBlobId,
  type CursorBlobStore,
  requireCursorStoreTtl,
  requirePositiveCursorStoreBound,
} from "./blob-store.js"

export const CursorSessionIdSchema: z.core.$ZodBranded<z.ZodString, "CursorSessionId"> = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value)
  .refine((value) =>
    [...value].every((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127
    }),
  )
  .brand<"CursorSessionId">()

export type CursorSessionId = z.output<typeof CursorSessionIdSchema>

export type CursorSessionStateStoreOptions = {
  readonly blobStore: CursorBlobStore
  readonly clock: Clock
  readonly maxKeysPerSession: number
  readonly maxSessions: number
  /** Logical milliseconds; zero expires sessions on the next store operation. */
  readonly ttlMs: number
}

export type CursorSessionStateStore = {
  readonly get: (sessionId: CursorSessionId, key: string) => Uint8Array | null
  readonly invalidate: (sessionId: CursorSessionId) => void
  readonly set: (sessionId: CursorSessionId, key: string, value: Uint8Array) => CursorBlobId | null
  readonly size: () => number
}

type SessionEntry = {
  readonly values: Map<string, CursorBlobId>
  readonly lastAccessMs: number
}

export function parseCursorSessionId(input: unknown): CursorSessionId {
  return CursorSessionIdSchema.parse(input)
}

export function createCursorSessionStateStore(
  options: CursorSessionStateStoreOptions,
): CursorSessionStateStore {
  requirePositiveCursorStoreBound(options.maxKeysPerSession, "maxKeysPerSession")
  requirePositiveCursorStoreBound(options.maxSessions, "maxSessions")
  requireCursorStoreTtl(options.ttlMs)
  const sessions = new Map<CursorSessionId, SessionEntry>()

  const remove = (sessionId: CursorSessionId): void => {
    const entry = sessions.get(sessionId)
    if (entry !== undefined) {
      sessions.delete(sessionId)
      for (const blobId of entry.values.values()) {
        options.blobStore.release(blobId)
      }
    }
  }

  const evictExpired = (nowMs: number): void => {
    for (const [sessionId, entry] of sessions) {
      if (nowMs - entry.lastAccessMs >= options.ttlMs) {
        remove(sessionId)
      }
    }
  }

  const evictToBounds = (): void => {
    while (sessions.size > options.maxSessions) {
      const oldest = sessions.keys().next().value
      if (oldest === undefined) {
        return
      }
      remove(oldest)
    }
  }

  const touch = (sessionId: CursorSessionId, entry: SessionEntry, nowMs: number): SessionEntry => {
    const updated = { values: entry.values, lastAccessMs: nowMs }
    sessions.delete(sessionId)
    sessions.set(sessionId, updated)
    return updated
  }

  const invalidate = remove

  return {
    get: (sessionId, key): Uint8Array | null => {
      const nowMs = options.clock.nowMs()
      evictExpired(nowMs)
      const entry = sessions.get(sessionId)
      const blobId = entry?.values.get(key)
      if (entry === undefined || blobId === undefined) {
        return null
      }
      const value = options.blobStore.get(blobId)
      if (value === null) {
        entry.values.delete(key)
        options.blobStore.release(blobId)
        if (entry.values.size === 0) {
          invalidate(sessionId)
        }
        return null
      }
      entry.values.delete(key)
      entry.values.set(key, blobId)
      touch(sessionId, entry, nowMs)
      return value
    },
    invalidate,
    set: (sessionId, key, value): CursorBlobId | null => {
      const blobId = options.blobStore.put(value)
      if (blobId === null || !options.blobStore.pin(blobId)) {
        return null
      }
      const nowMs = options.clock.nowMs()
      evictExpired(nowMs)
      const existing = sessions.get(sessionId)
      const entry =
        existing === undefined
          ? { values: new Map<string, CursorBlobId>(), lastAccessMs: nowMs }
          : touch(sessionId, existing, nowMs)
      const replaced = entry.values.get(key)
      entry.values.delete(key)
      entry.values.set(key, blobId)
      if (replaced !== undefined) {
        options.blobStore.release(replaced)
      }
      while (entry.values.size > options.maxKeysPerSession) {
        const oldestKey = entry.values.keys().next().value
        if (oldestKey === undefined) {
          break
        }
        const evicted = entry.values.get(oldestKey)
        entry.values.delete(oldestKey)
        if (evicted !== undefined) {
          options.blobStore.release(evicted)
        }
      }
      sessions.set(sessionId, entry)
      evictToBounds()
      if (!sessions.has(sessionId)) {
        options.blobStore.release(blobId)
        return null
      }
      return blobId
    },
    size: (): number => {
      evictExpired(options.clock.nowMs())
      return sessions.size
    },
  }
}
