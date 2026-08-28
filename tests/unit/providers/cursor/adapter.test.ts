import { describe, expect, it } from "bun:test"

import { parseModelId, parseProviderId } from "../../../../src/core/ids"
import { createCursorAdapter } from "../../../../src/providers/cursor/adapter"

describe("createCursorAdapter", () => {
  it("returns ready when a CLI access token yields models", async () => {
    // Given
    const adapter = createCursorAdapter({
      readAccessToken: async () => "cursor-token",
      listModels: async () => [{ id: parseModelId("default") }],
    })
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "ready",
      providerId: parseProviderId("cursor"),
      models: [{ id: parseModelId("default") }],
    })
  })

  it("returns unavailable when no access token exists", async () => {
    // Given
    const adapter = createCursorAdapter({
      readAccessToken: async () => null,
      listModels: async () => [{ id: parseModelId("default") }],
    })
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "unavailable",
      providerId: parseProviderId("cursor"),
      reason: "invalid-data",
    })
  })
})
