import { describe, expect, it } from "bun:test"

import { readXaiAccessState, type XaiAccessFile } from "../../../../src/providers/xai/access-state"

const record = JSON.stringify({
  schema_version: 1,
  provider: "xai",
  state: "ready",
  access: "synthetic",
  expires: 1,
})
const metadata = { regular: true, links: 1, mode: 0o600, ownerUid: 1000 }

describe("xAI opened file lifecycle", () => {
  it.each(["stat", "read", "uid", "mode", "owner", "close"])(
    "closes or rejects on %s failure",
    async (failure) => {
      // Given
      let closes = 0
      let reads = 0
      const file: XaiAccessFile = {
        stat: async () => {
          if (failure === "stat") throw new Error("stat failed")
          return {
            ...metadata,
            mode: failure === "mode" ? 0o644 : metadata.mode,
            ownerUid: failure === "owner" ? 2000 : metadata.ownerUid,
          }
        },
        readText: async () => {
          reads++
          if (failure === "read") throw new Error("read failed")
          return record
        },
        close: async () => {
          closes++
          if (failure === "close") throw new Error("close failed")
        },
      }
      // When
      const state = await readXaiAccessState({
        env: { XDG_DATA_HOME: "/synthetic" },
        currentUid: () => {
          if (failure === "uid") throw new Error("uid failed")
          return 1000
        },
        openFile: async () => file,
      })
      // Then
      expect(state).toEqual({ kind: "unavailable" })
      expect(closes).toBe(1)
      expect(reads).toBe(
        failure === "mode" || failure === "owner" || failure === "stat" || failure === "uid"
          ? 0
          : 1,
      )
    },
  )

  it("rejects a file when the current uid cannot be determined", async () => {
    // Given
    let reads = 0
    const file: XaiAccessFile = {
      stat: async () => metadata,
      readText: async () => {
        reads++
        return record
      },
      close: async () => undefined,
    }
    // When
    const state = await readXaiAccessState({
      env: { XDG_DATA_HOME: "/synthetic" },
      currentUid: () => undefined,
      openFile: async () => file,
    })
    // Then
    expect(state).toEqual({ kind: "unavailable" })
    expect(reads).toBe(0)
  })

  it("closes an opened handle even when a non-Error is thrown", async () => {
    // Given
    let closes = 0
    const file: XaiAccessFile = {
      stat: () => Promise.reject({ reason: "synthetic failure" }),
      readText: async () => record,
      close: async () => {
        closes++
      },
    }
    // When / Then
    await expect(
      readXaiAccessState({ env: { XDG_DATA_HOME: "/synthetic" }, openFile: async () => file }),
    ).rejects.toEqual({ reason: "synthetic failure" })
    expect(closes).toBe(1)
  })
})
