import { describe, expect, it } from "bun:test"

import { createConnectorLanguage } from "../../../src/opencode/language-factory"
import type { OllamaRuntime } from "../../../src/providers/ollama"
import { FakeHttpTransport } from "../../support/http"

describe("connector language routing", () => {
  it("does not register a Cursor or xAI language implementation", () => {
    // Given
    const createLanguage = createConnectorLanguage({
      transport: new FakeHttpTransport(),
      env: {},
      readAccessToken: async () => null,
      forceRefreshAccessToken: async () => null,
    })
    // When
    const cursor = createLanguage("cursor", "auto")
    // Then
    expect(cursor).toBeNull()
    expect(createLanguage("xai", "grok-fixture")).toBeNull()
  })

  it("retains Ollama generation through the configured daemon runtime", async () => {
    // Given
    let openedModel: string | undefined
    const ollamaRuntime: OllamaRuntime = {
      openChat: async (request) => {
        openedModel = request.model
        return new Response('{"message":{"content":"ok"},"done":true}\n')
      },
    }
    const createLanguage = createConnectorLanguage({
      transport: new FakeHttpTransport(),
      env: {},
      readAccessToken: async () => null,
      forceRefreshAccessToken: async () => null,
      ollamaRuntime,
    })
    const model = createLanguage("ollama", "local-model")
    if (model === null) throw new Error("Ollama was not registered")
    // When
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    })
    const parts = await Array.fromAsync(result.stream)
    // Then
    expect(model.provider).toBe("ollama")
    expect(openedModel).toBe("local-model")
    expect(parts).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "ok" }))
  })
})
