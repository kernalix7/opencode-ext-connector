import { describe, expect, it } from "bun:test"

import { parseModelId, parseProviderId } from "../../../../src/core/ids"
import { createClaudeAdapter } from "../../../../src/providers/claude/adapter"

describe("createClaudeAdapter", () => {
  it("returns ready with models when a token is present", async () => {
    // Given
    const adapter = createClaudeAdapter({
      readAccessToken: async () => "token",
      listModels: async () => [{ id: parseModelId("claude-sonnet-4-6") }],
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
      listModels: async () => [{ id: parseModelId("claude-sonnet-4-6") }],
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

  it("keeps last models as stale when a later list fails", async () => {
    // Given
    let calls = 0
    const adapter = createClaudeAdapter({
      readAccessToken: async () => "token",
      listModels: async () => {
        calls += 1
        if (calls === 1) {
          return [{ id: parseModelId("claude-sonnet-4-6") }]
        }
        throw new Error("network")
      },
    })
    await adapter.snapshot(new AbortController().signal)
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "stale",
      providerId: parseProviderId("claude"),
      models: [{ id: parseModelId("claude-sonnet-4-6") }],
      reason: "transport-error",
    })
  })
})
