import { describe, expect, it } from "bun:test"

import { AdapterError } from "../../../../src/core/errors"
import { createClaudeLanguageModel } from "../../../../src/providers/claude/language-model"
import { FakeHttpTransport } from "../../../support/http"

describe("createClaudeLanguageModel", () => {
  it("posts a disguised Anthropic request and returns text", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({ content: [{ type: "text", text: "hello from claude" }] }),
      ),
    })
    const model = createClaudeLanguageModel({
      modelId: "claude-sonnet-4-6",
      transport,
      readAccessToken: async () => "secret-token",
    })
    // When
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    const request = transport.requests.at(0)
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages")
    expect(request?.headers["user-agent"]).toBe("claude-cli/2.1.6 (external, sdk-cli)")
    expect(request?.headers["authorization"]).toBe("Bearer secret-token")
    expect(result.content).toEqual([{ type: "text", text: "hello from claude" }])
  })

  it("fails without credentials", async () => {
    // Given
    const model = createClaudeLanguageModel({
      modelId: "claude-sonnet-4-6",
      transport: new FakeHttpTransport(),
      readAccessToken: async () => null,
    })
    // When
    const promise = model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    await expect(promise).rejects.toBeInstanceOf(AdapterError)
  })
})
