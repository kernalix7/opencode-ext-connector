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
    const models = await listClaudeModels({
      transport,
      token: "token",
      version: "2.1.217",
      signal: new AbortController().signal,
    })
    // Then
    expect(models).toEqual([
      { id: parseModelId("claude-sonnet-4-6") },
      { id: parseModelId("claude-opus-4-6") },
    ])
    const request = transport.requests.at(0)
    expect(request?.url).toBe("https://api.anthropic.com/v1/models")
    expect(request?.headers["anthropic-beta"]).toContain("oauth-2025-04-20")
    expect(request?.headers["anthropic-dangerous-direct-browser-access"]).toBe("true")
    expect(request?.headers["x-app"]).toBe("cli")
    expect(request?.headers["user-agent"]).toContain("claude-cli/")
  })
})
