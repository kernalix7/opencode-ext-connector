import { describe, expect, it } from "bun:test"

import { opencodeAuthJsonPaths } from "../../../../src/opencode/auth-store"
import { mergeOpencodeAuthJson } from "../../../../src/providers/claude/auth-json"

describe("opencode auth.json", () => {
  it("keeps an explicit XDG profile isolated from Windows fallback paths", () => {
    // Given / When
    const paths = opencodeAuthJsonPaths(
      { XDG_DATA_HOME: "/xdg-data", LOCALAPPDATA: "C:\\Local" },
      "win32",
    )
    // Then
    expect(paths.some((path) => path.endsWith("/xdg-data/opencode/auth.json"))).toBe(true)
    expect(paths.some((path) => path.includes("Local") && path.endsWith("auth.json"))).toBe(false)
  })

  it("merges anthropic oauth without dropping other providers", () => {
    // Given
    const existing = { openai: { type: "api", key: "sk" } }
    // When
    const merged = JSON.parse(
      mergeOpencodeAuthJson(existing, {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAtMs: 9,
      }),
    )
    // Then
    expect(merged.openai).toEqual({ type: "api", key: "sk" })
    expect(merged.anthropic).toEqual({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: 9,
    })
  })
})
