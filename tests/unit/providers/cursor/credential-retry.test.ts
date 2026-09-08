import { describe, expect, it } from "bun:test"

import { isCursorCredentialRetryEligible } from "../../../../src/providers/cursor/credential-retry"
import { CursorDirectStreamError } from "../../../../src/providers/cursor/direct-stream"

const pristine = { outputEpoch: 0, checkpointEpoch: null, toolBoundary: false } as const

describe("Cursor credential retry eligibility", () => {
  it("accepts an unused typed HTTP 401 before semantic output", () => {
    // Given / When
    const eligible = isCursorCredentialRetryEligible({
      error: new CursorDirectStreamError("http-401"),
      replay: pristine,
      retryUsed: false,
    })

    // Then
    expect(eligible).toBe(true)
  })

  it.each([
    ["plain error", new Error("http-401"), pristine, false],
    ["HTTP 403", new CursorDirectStreamError("http-403"), pristine, false],
    ["Connect error", new CursorDirectStreamError("connect-status-16"), pristine, false],
    ["used retry", new CursorDirectStreamError("http-401"), pristine, true],
    [
      "prior output",
      new CursorDirectStreamError("http-401"),
      { outputEpoch: 1, checkpointEpoch: null, toolBoundary: false },
      false,
    ],
    [
      "prior checkpoint",
      new CursorDirectStreamError("http-401"),
      { outputEpoch: 0, checkpointEpoch: 0, toolBoundary: false },
      false,
    ],
    [
      "prior tool boundary",
      new CursorDirectStreamError("http-401"),
      { outputEpoch: 0, checkpointEpoch: null, toolBoundary: true },
      false,
    ],
  ])("rejects %s", (_name, error, replay, retryUsed) => {
    // Given / When
    const eligible = isCursorCredentialRetryEligible({ error, replay, retryUsed })

    // Then
    expect(eligible).toBe(false)
  })
})
