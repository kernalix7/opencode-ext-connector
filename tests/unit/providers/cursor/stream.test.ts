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

  it("emits tool-input and tool-call parts for tool_call NDJSON", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "should not be called",
      streamNdjson: async function* (_prompt: string, _signal: AbortSignal) {
        yield '{"type":"tool_call","subtype":"started","call_id":"call-1","name":"Read","arguments":{"path":"a.ts"}}'
        yield '{"type":"result","result":""}'
      },
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const parts: { type: string; toolName?: string; toolCallId?: string }[] = []
    for await (const part of stream) {
      if (part.type === "tool-input-start") {
        parts.push({ type: part.type, toolName: part.toolName })
      } else if (part.type === "tool-call") {
        parts.push({ type: part.type, toolCallId: part.toolCallId, toolName: part.toolName })
      } else if (part.type === "finish") {
        parts.push({ type: part.type })
      }
    }
    // Then
    expect(parts).toEqual([
      { type: "tool-input-start", toolName: "Read" },
      { type: "tool-call", toolCallId: "call-1", toolName: "Read" },
      { type: "finish" },
    ])
  })

  it("maps nested ReadToolCall payloads to the Read tool name", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "should not be called",
      streamNdjson: async function* (_prompt: string, _signal: AbortSignal) {
        yield '{"type":"tool_call","subtype":"started","call_id":"c2","tool_call":{"ReadToolCall":{"args":{"path":"b.ts"}}}}'
      },
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const names: string[] = []
    for await (const part of stream) {
      if (part.type === "tool-input-start") {
        names.push(part.toolName)
      }
    }
    // Then
    expect(names).toEqual(["Read"])
  })
})
