import { describe, expect, it } from "bun:test"

import { AdapterError } from "../../../../src/core/errors"
import { createCursorLanguageModel } from "../../../../src/providers/cursor/language-model"

describe("createCursorLanguageModel", () => {
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
})
