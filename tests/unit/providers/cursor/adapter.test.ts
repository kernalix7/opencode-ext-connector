import { describe, expect, it } from "bun:test"

import { parseModelId, parseProviderId } from "../../../../src/core/ids"
import { createCursorAdapter } from "../../../../src/providers/cursor/adapter"

describe("createCursorAdapter", () => {
  it("returns ready when cursor-agent is available", async () => {
    // Given
    const adapter = createCursorAdapter({
      resolveAgent: async () => "/usr/bin/cursor-agent",
      listModels: async () => [{ id: parseModelId("auto") }],
    })
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "ready",
      providerId: parseProviderId("cursor"),
      models: [{ id: parseModelId("auto") }],
    })
  })

  it("returns unavailable when cursor-agent is missing", async () => {
    // Given
    const adapter = createCursorAdapter({
      resolveAgent: async () => null,
      listModels: async () => [{ id: parseModelId("auto") }],
    })
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toEqual({
      status: "unavailable",
      providerId: parseProviderId("cursor"),
      reason: "process-error",
    })
  })
})
