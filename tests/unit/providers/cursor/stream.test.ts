import { describe, expect, it } from "bun:test"

import { createCursorLanguageModel } from "../../../../src/providers/cursor/language-model"

describe("createCursorLanguageModel doStream", () => {
  it("yields incremental text-delta parts from streamNdjson NDJSON lines", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "should not be called",
      streamNdjson: async function* (_prompt: string, _signal: AbortSignal) {
        yield '{"type":"text","text":"hel"}'
        yield '{"type":"text","text":"lo"}'
        yield '{"type":"result","result":""}'
      },
    })

    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: { type: string; delta?: string }[] = []
    for await (const part of stream) {
      if (part.type === "text-delta") {
        parts.push({ type: part.type, delta: part.delta })
      } else if (part.type === "finish") {
        parts.push({ type: part.type })
      }
    }

    // Then
    expect(parts).toEqual([
      { type: "text-delta", delta: "hel" },
      { type: "text-delta", delta: "lo" },
      { type: "finish" },
    ])
  })

  it("falls back to runPrompt when streamNdjson is not provided", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "fallback text",
    })

    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: { type: string; delta?: string }[] = []
    for await (const part of stream) {
      if (part.type === "text-delta") {
        parts.push({ type: part.type, delta: part.delta })
      } else if (part.type === "finish") {
        parts.push({ type: part.type })
      }
    }

    // Then
    expect(parts).toEqual([{ type: "text-delta", delta: "fallback text" }, { type: "finish" }])
  })
})
