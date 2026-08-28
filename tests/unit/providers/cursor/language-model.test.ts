import { describe, expect, it } from "bun:test"

import { AdapterError } from "../../../../src/core/errors"
import { createCursorLanguageModel } from "../../../../src/providers/cursor/language-model"

describe("createCursorLanguageModel", () => {
  it("routes streaming through the direct session runtime", async () => {
    // Given
    let calls = 0
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => null,
      directRuntime: {
        doStream: async () => {
          calls += 1
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: "stream-start", warnings: [] })
                controller.enqueue({
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: {
                    inputTokens: {
                      total: 0,
                      noCache: undefined,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: { total: 0, text: 0, reasoning: 0 },
                  },
                })
                controller.close()
              },
            }),
          }
        },
      },
    })

    // When
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    await Array.fromAsync(result.stream)

    // Then
    expect(calls).toBe(1)
  })

  it("returns runner text as generated content", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "hello from cursor",
    })
    // When
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    expect(result.content).toEqual([{ type: "text", text: "hello from cursor" }])
    expect(result.finishReason.unified).toBe("stop")
  })

  it("fails when the runner is unavailable", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => null,
    })
    // When
    const promise = model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    await expect(promise).rejects.toBeInstanceOf(AdapterError)
  })

  it("includes tool results in the runner prompt", async () => {
    // Given
    let seen = ""
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async (prompt) => {
        seen = prompt
        return "ok"
      },
    })
    // When
    await model.doGenerate({
      prompt: [
        { role: "user", content: [{ type: "text", text: "read it" }] },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              toolName: "Read",
              output: { type: "text", value: "file body" },
            },
          ],
        },
      ],
    })
    // Then
    expect(seen).toContain("read it")
    expect(seen).toContain("c1")
    expect(seen).toContain("file body")
  })
})
