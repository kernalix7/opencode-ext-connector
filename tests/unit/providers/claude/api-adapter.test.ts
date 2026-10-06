import { describe, expect, it } from "bun:test"

import { OperationCancelledError } from "../../../../src/core/errors"
import { parseModelId } from "../../../../src/core/ids"
import { createClaudeAdapter } from "../../../../src/providers/claude/api-adapter"

describe("official Claude adapter", () => {
  it("retains stale models only for the same key and clears on missing key", async () => {
    // Given
    let key: string | null = "key-a"
    let failure = false
    const adapter = createClaudeAdapter({
      readApiKey: async () => key,
      listModels: async (currentKey) => {
        if (failure) throw new Error("catalog unavailable")
        return [{ id: parseModelId(currentKey) }]
      },
    })
    const signal = new AbortController().signal
    expect((await adapter.snapshot(signal)).status).toBe("ready")
    failure = true
    // When / Then
    expect(await adapter.snapshot(signal)).toMatchObject({
      status: "stale",
      models: [{ id: parseModelId("key-a") }],
    })
    key = "key-b"
    expect(await adapter.snapshot(signal)).toMatchObject({
      status: "unavailable",
      reason: "transport-error",
    })
    key = null
    expect(await adapter.snapshot(signal)).toMatchObject({
      status: "unavailable",
      reason: "invalid-data",
    })
    key = "key-a"
    expect(await adapter.snapshot(signal)).toMatchObject({
      status: "unavailable",
      reason: "transport-error",
    })
  })

  it("propagates cancellation from the catalog instead of serving stale models", async () => {
    // Given
    let cancel = false
    const adapter = createClaudeAdapter({
      readApiKey: async () => "key-a",
      listModels: async () => {
        if (cancel) throw new OperationCancelledError("http-request")
        return [{ id: parseModelId("claude-a") }]
      },
    })
    await adapter.snapshot(new AbortController().signal)
    cancel = true
    // When / Then
    await expect(adapter.snapshot(new AbortController().signal)).rejects.toBeInstanceOf(
      OperationCancelledError,
    )
  })
})
