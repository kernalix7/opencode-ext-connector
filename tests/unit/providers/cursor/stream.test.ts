import { describe, expect, it } from "bun:test"

import { createCursorLanguageModel } from "../../../../src/providers/cursor/language-model"

describe("createCursorLanguageModel doStream", () => {
  it("yields incremental text-delta parts from streamNdjson NDJSON lines", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "should not be called",
      streamNdjson: async function* (_prompt: string, _signal: AbortSignal) {
        yield '{"type":"assistant","message":{"content":[{"type":"text","text":"hel"}]},"timestamp_ms":1}'
        yield '{"type":"assistant","message":{"content":[{"type":"text","text":"lo"}]},"timestamp_ms":2}'
        yield '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}'
        yield '{"type":"result","result":"hello"}'
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
      tools: [{ type: "function", name: "read", inputSchema: { type: "object" } }],
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
      { type: "tool-input-start", toolName: "read" },
      { type: "tool-call", toolCallId: "call-1", toolName: "read" },
      { type: "finish" },
    ])
  })

  it("maps nested ReadToolCall payloads to the Read tool name", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "should not be called",
      streamNdjson: async function* (_prompt: string, _signal: AbortSignal) {
        yield '{"type":"tool_call","subtype":"started","call_id":"c2","tool_call":{"readToolCall":{"args":{"path":"b.ts","limit":20}}}}'
      },
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [
        {
          type: "function",
          name: "read",
          inputSchema: {
            type: "object",
            properties: { filePath: { type: "string" } },
            additionalProperties: false,
          },
        },
      ],
    })
    const names: string[] = []
    const inputs: string[] = []
    for await (const part of stream) {
      if (part.type === "tool-input-start") {
        names.push(part.toolName)
      } else if (part.type === "tool-call") {
        inputs.push(part.input)
      }
    }
    // Then
    expect(names).toEqual(["read"])
    expect(inputs).toEqual(['{"filePath":"b.ts"}'])
  })

  it("emits balanced reasoning parts from thinking snapshots", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "",
      streamNdjson: async function* () {
        yield '{"type":"thinking","text":"plan"}'
        yield '{"type":"thinking","text":"plan more"}'
        yield '{"type":"assistant","text":"done"}'
      },
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const parts: { readonly type: string; readonly delta?: string }[] = []
    for await (const part of stream) {
      if (part.type === "reasoning-delta") {
        parts.push({ type: part.type, delta: part.delta })
      } else if (part.type === "reasoning-start" || part.type === "reasoning-end") {
        parts.push({ type: part.type })
      }
    }
    // Then
    expect(parts).toEqual([
      { type: "reasoning-start" },
      { type: "reasoning-delta", delta: "plan" },
      { type: "reasoning-delta", delta: " more" },
      { type: "reasoning-end" },
    ])
  })

  it("surfaces failed result events as stream errors", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "",
      streamNdjson: async function* () {
        yield '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom"}'
      },
    })
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // When
    const consume = async (): Promise<void> => {
      for await (const _part of stream) {
        void _part
      }
    }
    // Then
    await expect(consume()).rejects.toThrow("boom")
  })

  it("marks Cursor-owned tools provider-executed and keeps reading", async () => {
    // Given
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => "",
      streamNdjson: async function* () {
        yield '{"type":"tool_call","subtype":"started","call_id":"native-1","name":"CursorNative","arguments":{}}'
        yield '{"type":"assistant","text":"continued"}'
      },
    })
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // When
    let providerExecuted = false
    let text = ""
    for await (const part of stream) {
      if (part.type === "tool-call") {
        providerExecuted = part.providerExecuted ?? false
      } else if (part.type === "text-delta") {
        text += part.delta
      }
    }
    // Then
    expect(providerExecuted).toBe(true)
    expect(text).toBe("continued")
  })
})
