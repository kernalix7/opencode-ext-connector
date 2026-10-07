import { describe, expect, it } from "bun:test"

import { OperationCancelledError } from "../../../../src/core/errors"
import { parseModelId } from "../../../../src/core/ids"
import { createClaudeAdapter } from "../../../../src/providers/claude/adapter"
import { listClaudeModels } from "../../../../src/providers/claude/models"
import { FakeHttpTransport } from "../../../support/http"

describe("Claude subscription catalog", () => {
  it("discovers branded models using bearer metadata and dynamic version", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(JSON.stringify({ data: [{ id: "claude-sonnet-4-6" }] })),
    })
    // When
    const models = await listClaudeModels({
      transport,
      token: "fixture-token",
      version: "9.8.7",
      signal: new AbortController().signal,
    })
    // Then
    expect(models).toEqual([{ id: parseModelId("claude-sonnet-4-6") }])
    expect(transport.requests[0]?.headers["authorization"]).toBe("Bearer fixture-token")
    expect(transport.requests[0]?.headers["x-api-key"]).toBeUndefined()
    expect(transport.requests[0]?.headers["user-agent"]).toContain("9.8.7")
  })

  it("never exposes another token's cached models", async () => {
    // Given
    let token: string | null = "account-a"
    const adapter = createClaudeAdapter({
      readAccessToken: async () => token,
      listModels: async (current) =>
        current === "account-a" ? [{ id: parseModelId("claude-a") }] : [],
    })
    await adapter.snapshot(new AbortController().signal)
    token = "account-b"
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot.status).toBe("unavailable")
    await adapter.dispose()
  })

  it("does not convert cancellation into a stale success", async () => {
    // Given
    const controller = new AbortController()
    let calls = 0
    const adapter = createClaudeAdapter({
      readAccessToken: async () => "account-a",
      listModels: async () => {
        calls++
        if (calls === 1) return [{ id: parseModelId("claude-a") }]
        controller.abort()
        throw new OperationCancelledError("catalog")
      },
    })
    await adapter.snapshot(new AbortController().signal)
    // When / Then
    await expect(adapter.snapshot(controller.signal)).rejects.toBeInstanceOf(
      OperationCancelledError,
    )
    await adapter.dispose()
  })
})
