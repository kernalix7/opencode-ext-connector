import { describe, expect, it } from "bun:test"
import { createConnectorLanguage } from "../../../src/opencode/language-factory"
import { disposeV1LanguageRuntime } from "../../../src/opencode/v1-language"
import type { CursorDirectRuntime } from "../../../src/providers/cursor/direct-runtime"
import type { OllamaRuntime } from "../../../src/providers/ollama"
import { FakeHttpTransport } from "../../support/http"

describe("createConnectorLanguage", () => {
  it("routes Cursor streaming through the direct runtime", async () => {
    // Given
    let streamCalls = 0
    const cursorRuntime: CursorDirectRuntime = {
      doStream: async () => {
        streamCalls += 1
        return {
          stream: new ReadableStream({
            start(controller): void {
              controller.close()
            },
          }),
        }
      },
      dispose: async () => undefined,
    }
    const createLanguage = createConnectorLanguage({
      env: {},
      transport: new FakeHttpTransport(),
      readClaudeToken: async () => null,
      cursorRuntime,
      ollamaRuntime: { openChat: async () => new Response() },
    })
    const model = createLanguage("cursor", "auto")

    // When
    const result = await model?.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    })
    await Array.fromAsync(result?.stream ?? [])

    // Then
    expect(streamCalls).toBe(1)
  })

  it("dispatches Ollama through the shared runtime", async () => {
    // Given
    let openedModel: string | undefined
    const ollamaRuntime: OllamaRuntime = {
      openChat: async (request) => {
        openedModel = request.model
        return new Response('{"message":{"content":"ok"},"done":true}\n')
      },
    }
    const cursorRuntime: CursorDirectRuntime = {
      doStream: async () => ({ stream: new ReadableStream() }),
      dispose: async () => undefined,
    }
    const createLanguage = createConnectorLanguage({
      env: {},
      transport: new FakeHttpTransport(),
      readClaudeToken: async () => null,
      cursorRuntime,
      ollamaRuntime,
    })
    const model = createLanguage("ollama", "local-model")

    // When
    const stream = await model?.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    })
    await Array.fromAsync(stream?.stream ?? [])

    // Then
    expect(model?.provider).toBe("ollama")
    expect(openedModel).toBe("local-model")
  })
})

describe("disposeV1LanguageRuntime", () => {
  it("returns the same disposal promise when called repeatedly", async () => {
    // Given
    const first = disposeV1LanguageRuntime()

    // When
    const second = disposeV1LanguageRuntime()

    // Then
    expect(second).toBe(first)
    await first
  })
})
