import { describe, expect, it } from "bun:test"

import { parseCursorCredentials } from "../../../../src/providers/cursor/credentials"

describe("parseCursorCredentials", () => {
  it("reads accessToken from a Cursor CLI auth.json object", () => {
    // Given
    const raw = { accessToken: "tok_live_1", refreshToken: "ref_live_1" }

    // When
    const parsed = parseCursorCredentials(raw)

    // Then
    expect(parsed).toEqual({ accessToken: "tok_live_1", refreshToken: "ref_live_1" })
  })

  it("accepts accessToken without refreshToken", () => {
    // Given
    const raw = { accessToken: "tok_only" }

    // When
    const parsed = parseCursorCredentials(raw)

    // Then
    expect(parsed).toEqual({ accessToken: "tok_only", refreshToken: null })
  })

  it("returns null when accessToken is missing", () => {
    // Given
    const raw = { refreshToken: "ref_only" }

    // When
    const parsed = parseCursorCredentials(raw)

    // Then
    expect(parsed).toBeNull()
  })
})
