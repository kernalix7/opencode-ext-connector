import { describe, expect, it } from "bun:test"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../../../src/core/errors"
import { createClaudeSubscriptionLanguageModel } from "../../../../src/providers/claude/subscription-language-model"
import { FakeHttpTransport } from "../../../support/http"

const prompt: LanguageModelV3CallOptions["prompt"] = [
  { role: "user", content: [{ type: "text", text: "fixture input" }] },
]
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

describe("Claude subscription V3", () => {
  it("generates with bearer auth, dynamic version, tool names and SDK usage", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      body: bytes({
        type: "message",
        id: "msg_1",
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "call_1", name: "mcp_Weather", input: { city: "Seoul" } },
        ],
        usage: { input_tokens: 7, output_tokens: 4 },
      }),
    })
    const model = createClaudeSubscriptionLanguageModel({
      modelId: "claude-sonnet-4-6",
      transport,
      readAccessToken: async () => "fixture-token",
      forceRefreshAccessToken: async () => null,
      readVersion: async () => "9.8.7",
    })
    // When
    const result = await model.doGenerate({
      prompt,
      maxOutputTokens: 64,
      tools: [
        { type: "function", name: "weather", inputSchema: { type: "object", properties: {} } },
      ],
    })
    // Then
    expect(result.content).toContainEqual({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "weather",
      input: '{"city":"Seoul"}',
    })
    expect(result.usage.inputTokens.total).toBe(7)
    expect(transport.requests).toHaveLength(1)
    const request = transport.requests[0]
    expect(request?.headers["authorization"]).toBe("Bearer fixture-token")
    expect(request?.headers["x-api-key"]).toBeUndefined()
    expect(request?.headers["user-agent"]).toContain("9.8.7")
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages?beta=true")
    const body = JSON.parse(new TextDecoder().decode(request?.body ?? new Uint8Array()))
    expect(body.tools[0].name).toBe("mcp_Weather")
    expect(body.messages[0].content[0].text).toBe("fixture input")
  })

  it("streams fragmented tool events with SDK usage and restored names", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const events = [
      {
        type: "message_start",
        message: { id: "msg_2", model: "claude-sonnet-4-6", usage: { input_tokens: 5 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call_2", name: "mcp_Weather", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"city":"Seoul"}' },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ]
    transport.enqueueChunkedResponse({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: new TextEncoder().encode(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
      ),
    })
    const model = createClaudeSubscriptionLanguageModel({
      modelId: "claude-sonnet-4-6",
      transport,
      readAccessToken: async () => "fixture-token",
      forceRefreshAccessToken: async () => null,
      readVersion: async () => "9.8.7",
    })
    // When
    const result = await model.doStream({ prompt, maxOutputTokens: 64 })
    const parts = await Array.fromAsync(result.stream)
    // Then
    expect(parts).toContainEqual(
      expect.objectContaining({ type: "tool-call", toolName: "weather", toolCallId: "call_2" }),
    )
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "finish",
        usage: expect.objectContaining({
          inputTokens: expect.objectContaining({ total: 5 }),
          outputTokens: expect.objectContaining({ total: 3 }),
        }),
      }),
    )
    expect(transport.requests).toHaveLength(1)
  })

  it("rejects absent credentials and cancellation without a transport call", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const model = createClaudeSubscriptionLanguageModel({
      modelId: "claude-sonnet-4-6",
      transport,
      readAccessToken: async () => null,
      forceRefreshAccessToken: async () => null,
      readVersion: async () => "9.8.7",
    })
    const cancelled = new AbortController()
    cancelled.abort()
    // When / Then
    await expect(model.doGenerate({ prompt })).rejects.toBeInstanceOf(AdapterError)
    await expect(model.doStream({ prompt, abortSignal: cancelled.signal })).rejects.toBeInstanceOf(
      OperationCancelledError,
    )
    expect(transport.requests).toHaveLength(0)
  })
})
