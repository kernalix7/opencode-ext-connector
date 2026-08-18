import { describe, expect, it } from "bun:test"

import { parseModelId, parseProviderId } from "../../../../src/core/ids"
import { createClaudeAdapter } from "../../../../src/providers/claude/adapter"

describe("createClaudeAdapter", () => {
  it("returns ready with models when a token is present", async () => {
    // Given
    const adapter = createClaudeAdapter({
      readAccessToken: async () => "token",
      models: [{ id: parseModelId("claude-sonnet-4-6") }],
    })
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "ready",
      providerId: parseProviderId("claude"),
      models: [{ id: parseModelId("claude-sonnet-4-6") }],
    })
  })

  it("returns unavailable when credentials are missing", async () => {
    // Given
    const adapter = createClaudeAdapter({
      readAccessToken: async () => null,
      models: [{ id: parseModelId("claude-sonnet-4-6") }],
    })
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "unavailable",
      providerId: parseProviderId("claude"),
      reason: "invalid-data",
    })
  })
})
