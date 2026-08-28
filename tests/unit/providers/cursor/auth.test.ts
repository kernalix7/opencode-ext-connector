import { describe, expect, it } from "bun:test"

import { readCursorAccessToken } from "../../../../src/providers/cursor/auth"

describe("readCursorAccessToken", () => {
  it("prefers CURSOR_ACCESS_TOKEN over the CLI auth file", async () => {
    // Given
    const signal = new AbortController().signal

    // When
    const token = await readCursorAccessToken(
      { CURSOR_ACCESS_TOKEN: "env-token", HOME: "/tmp/missing-home" },
      signal,
      {
        readAuthFile: async () => ({ accessToken: "file-token", refreshToken: null }),
      },
    )

    // Then
    expect(token).toBe("env-token")
  })

  it("reads the CLI auth file when env is unset", async () => {
    // Given
    const signal = new AbortController().signal

    // When
    const token = await readCursorAccessToken({ HOME: "/tmp/missing-home" }, signal, {
      readAuthFile: async () => ({ accessToken: "file-token", refreshToken: "ref" }),
    })

    // Then
    expect(token).toBe("file-token")
  })

  it("returns null when no token source exists", async () => {
    // Given
    const signal = new AbortController().signal

    // When
    const token = await readCursorAccessToken({ HOME: "/tmp/missing-home" }, signal, {
      readAuthFile: async () => null,
    })

    // Then
    expect(token).toBeNull()
  })
})
