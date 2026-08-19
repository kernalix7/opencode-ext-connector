import { describe, expect, it } from "bun:test"

import { parseModelId, parseProviderId } from "../../../../src/core/ids"
import { createCommandCodeAdapter } from "../../../../src/providers/command-code/adapter"

describe("createCommandCodeAdapter", () => {
  it("returns ready when CLI auth exists", async () => {
    // Given
    const adapter = createCommandCodeAdapter({
      readAccessToken: async () => "cc-token",
      listModels: async () => [{ id: parseModelId("default") }],
    })
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "ready",
      providerId: parseProviderId("command-code"),
      models: [{ id: parseModelId("default") }],
    })
  })

  it("returns unavailable when CLI auth is missing", async () => {
    // Given
    const adapter = createCommandCodeAdapter({
      readAccessToken: async () => null,
      listModels: async () => [{ id: parseModelId("default") }],
    })
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "unavailable",
      providerId: parseProviderId("command-code"),
      reason: "invalid-data",
    })
  })
})
