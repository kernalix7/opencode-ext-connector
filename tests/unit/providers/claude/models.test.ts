import { describe, expect, it } from "bun:test"

import { parseModelId } from "../../../../src/core/ids"
import { listClaudeModels } from "../../../../src/providers/claude/models"
import { FakeHttpTransport } from "../../../support/http"

describe("listClaudeModels", () => {
  it("reads ids from Anthropic /v1/models", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({ data: [{ id: "claude-sonnet-4-6" }, { id: "claude-opus-4-6" }] }),
      ),
    })
    // When
    const models = await listClaudeModels(transport, "token", new AbortController().signal)
    // Then
    expect(models).toEqual([
      { id: parseModelId("claude-sonnet-4-6") },
      { id: parseModelId("claude-opus-4-6") },
    ])
    expect(transport.requests.at(0)?.url).toBe("https://api.anthropic.com/v1/models")
  })
})
