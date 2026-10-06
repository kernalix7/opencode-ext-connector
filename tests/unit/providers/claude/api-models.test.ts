import { describe, expect, it } from "bun:test"

import { OperationCancelledError } from "../../../../src/core/errors"
import { parseModelId } from "../../../../src/core/ids"
import { listClaudeModels } from "../../../../src/providers/claude/api-models"
import { FakeHttpTransport } from "../../../support/http"

const response = (data: readonly string[], hasMore: boolean, lastId: string | null) => ({
  status: 200,
  headers: {},
  body: new TextEncoder().encode(
    JSON.stringify({
      data: data.map((id) => ({ id, type: "model" })),
      has_more: hasMore,
      last_id: lastId,
    }),
  ),
})

describe("official Claude catalog", () => {
  it("follows after_id with only API-key authentication when more pages exist", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(response(["claude-a"], true, "claude-a"))
    transport.enqueueResponse(response(["claude-b"], false, "claude-b"))
    // When
    const models = await listClaudeModels({
      transport,
      apiKey: "fixture-key",
      signal: new AbortController().signal,
    })
    // Then
    expect(models).toEqual([{ id: parseModelId("claude-a") }, { id: parseModelId("claude-b") }])
    expect(transport.requests.map((request) => request.url)).toEqual([
      "https://api.anthropic.com/v1/models",
      "https://api.anthropic.com/v1/models?after_id=claude-a",
    ])
    expect(transport.requests[0]?.headers).toEqual({
      "x-api-key": "fixture-key",
      "anthropic-version": "2023-06-01",
    })
  })

  it("rejects invalid cursor rather than returning an incomplete catalog", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(response(["claude-a"], true, null))
    // When / Then
    await expect(
      listClaudeModels({ transport, apiKey: "fixture-key", signal: new AbortController().signal }),
    ).rejects.toThrow()
  })

  it("does not dispatch when already cancelled", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const controller = new AbortController()
    controller.abort()
    // When / Then
    await expect(
      listClaudeModels({ transport, apiKey: "fixture-key", signal: controller.signal }),
    ).rejects.toBeInstanceOf(OperationCancelledError)
    expect(transport.requests).toHaveLength(0)
  })
})
