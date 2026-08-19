import { describe, expect, it } from "bun:test"

import { claudeCredentialsFileBody } from "../../../../src/providers/claude/writeback"

describe("claudeCredentialsFileBody", () => {
  it("serializes oauth fields for .credentials.json", () => {
    // Given
    const credentials = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAtMs: 1_700,
    }
    // When
    const body = JSON.parse(claudeCredentialsFileBody(credentials))
    // Then
    expect(body).toEqual({
      claudeAiOauth: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 1_700,
      },
    })
  })
})
