import type { CursorBlobId, CursorBlobStore } from "./blob-store"

export type CursorRequestBlobOwnership = {
  readonly blobIds: readonly CursorBlobId[]
  readonly release: () => void
  readonly [Symbol.dispose]: () => void
}

export type CursorRequestBlobCollector = {
  readonly acquire: (blobId: CursorBlobId) => void
  readonly finish: () => CursorRequestBlobOwnership
  readonly rollback: () => void
}

export class CursorRequestBlobOwnershipError extends Error {
  public constructor() {
    super("Cursor request blob ownership could not acquire content")
    this.name = "CursorRequestBlobOwnershipError"
  }
}

export function createCursorRequestBlobCollector(
  store: CursorBlobStore,
): CursorRequestBlobCollector {
  const blobIds: CursorBlobId[] = []
  let state: "collecting" | "owned" | "released" = "collecting"

  const release = (): void => {
    if (state === "released") return
    state = "released"
    for (const blobId of blobIds) store.release(blobId)
  }

  return {
    acquire: (blobId): void => {
      if (state !== "collecting") throw new CursorRequestBlobOwnershipError()
      if (blobIds.includes(blobId)) return
      if (!store.pin(blobId)) throw new CursorRequestBlobOwnershipError()
      blobIds.push(blobId)
    },
    finish: (): CursorRequestBlobOwnership => {
      if (state !== "collecting") throw new CursorRequestBlobOwnershipError()
      state = "owned"
      return Object.freeze({
        blobIds: Object.freeze([...blobIds]),
        release,
        [Symbol.dispose]: release,
      })
    },
    rollback: release,
  }
}
