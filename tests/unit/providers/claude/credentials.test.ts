import { describe, expect, it } from "bun:test"

import { parseClaudeCredentials } from "../../../../src/providers/claude/credentials"

describe("parseClaudeCredentials", () => {
  it("reads wrapped claudeAiOauth fields", () => {
    // Given
    const raw = {
      claudeAiOauth: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 1_700_000_000_000,
      },
    }
    // When
    const parsed = parseClaudeCredentials(raw)
    // Then
    expect(parsed).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAtMs: 1_700_000_000_000,
    })
  })

  it("returns null when accessToken is missing", () => {
    // Given / When / Then
    expect(parseClaudeCredentials({ refreshToken: "x" })).toBeNull()
  })
})
