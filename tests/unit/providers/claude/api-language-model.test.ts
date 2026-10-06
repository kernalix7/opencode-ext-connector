import { describe, expect, it } from "bun:test"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../../../src/core/errors"
import { createClaudeLanguageModel } from "../../../../src/providers/claude/api-language-model"
import { FakeHttpTransport } from "../../../support/http"

const prompt: LanguageModelV3CallOptions["prompt"] = [
  { role: "user", content: [{ type: "text", text: "hi" }] },
]
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

describe("official Claude V3 model", () => {
  it("generates text, tool calls and usage with the current explicit key", async () => {
    // Given
    const transport = new FakeHttpTransport()
    let key = "fixture-a"
    const model = createClaudeLanguageModel({
      modelId: "claude-a",
      transport,
      readApiKey: async () => key,
    })
    const body = {
      type: "message",
      id: "msg_1",
      model: "claude-a",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "hello" },
        { type: "tool_use", id: "tool_1", name: "weather", input: { city: "Seoul" } },
      ],
      usage: { input_tokens: 7, output_tokens: 4 },
    }
    transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      body: encode(body),
    })
    transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      body: encode(body),
    })
    // When
    const result = await model.doGenerate({
      prompt: [...prompt],
      maxOutputTokens: 64,
      tools: [
        { type: "function", name: "weather", inputSchema: { type: "object", properties: {} } },
      ],
    })
    key = "fixture-b"
    await model.doGenerate({ prompt: [...prompt], maxOutputTokens: 64 })
    // Then
    expect(model.provider).toBe("claude")
    expect(result.content).toContainEqual({ type: "text", text: "hello" })
    expect(result.content).toContainEqual({
      type: "tool-call",
      toolCallId: "tool_1",
      toolName: "weather",
      input: '{"city":"Seoul"}',
    })
    expect(result.usage.inputTokens.total).toBe(7)
    expect(result.usage.outputTokens.total).toBe(4)
    expect(transport.requests.map((request) => request.headers["x-api-key"])).toEqual([
      "fixture-a",
      "fixture-b",
    ])
    expect(transport.requests[0]?.url).toBe("https://api.anthropic.com/v1/messages")
    expect(transport.requests[0]?.headers["authorization"]).toBeUndefined()
    expect(
      JSON.parse(new TextDecoder().decode(transport.requests[0]?.body ?? new Uint8Array())).tools[0]
        .name,
    ).toBe("weather")
  })

  it("streams SDK-converted text and usage events", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const events = [
      {
        type: "message_start",
        message: { id: "msg_2", model: "claude-a", usage: { input_tokens: 5 } },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ]
    transport.enqueueChunkedResponse({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: new TextEncoder().encode(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
      ),
    })
    const model = createClaudeLanguageModel({
      modelId: "claude-a",
      transport,
      readApiKey: async () => "fixture-key",
    })
    // When
    const result = await model.doStream({ prompt: [...prompt], maxOutputTokens: 64 })
    const parts = await Array.fromAsync(result.stream)
    // Then
    expect(parts).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "hello" }))
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "finish",
        usage: expect.objectContaining({
          inputTokens: expect.objectContaining({ total: 5 }),
          outputTokens: expect.objectContaining({ total: 2 }),
        }),
      }),
    )
  })

  it("rejects missing and cancelled credentials before dispatch", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const model = createClaudeLanguageModel({
      modelId: "claude-a",
      transport,
      readApiKey: async () => null,
    })
    const controller = new AbortController()
    controller.abort()
    // When / Then
    await expect(model.doGenerate({ prompt: [...prompt] })).rejects.toBeInstanceOf(AdapterError)
    await expect(
      model.doStream({ prompt: [...prompt], abortSignal: controller.signal }),
    ).rejects.toBeInstanceOf(OperationCancelledError)
    expect(transport.requests).toHaveLength(0)
  })
})
