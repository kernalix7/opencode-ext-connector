import { describe, expect, it } from "bun:test"

import { createClaudeLanguageModel } from "../../../../src/providers/claude/language-model"
import { FakeHttpTransport } from "../../../support/http"

describe("createClaudeLanguageModel doStream", () => {
  it("parses Anthropic SSE and emits stream parts", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const sseBody = new TextEncoder().encode(
      "event: message_start\n\n" +
        "event: content_block_start\n" +
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n' +
        "event: content_block_delta\n" +
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
        "event: content_block_stop\n" +
        'data: {"type":"content_block_stop","index":0}\n\n' +
        "event: message_delta\n" +
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    )
    transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sseBody,
    })
    const model = createClaudeLanguageModel({
      modelId: "claude-sonnet-4-6",
      transport,
      readAccessToken: async () => "secret-token",
    })

    // When
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    // Then
    const parts: Array<{
      readonly type: string
      readonly id?: string
      readonly delta?: string
      readonly finishReason?: { readonly unified: string; readonly raw: string | undefined }
    }> = []
    for await (const part of result.stream) {
      parts.push(part)
    }

    expect(parts.some((p) => p.type === "stream-start")).toBe(true)
    expect(parts.some((p) => p.type === "text-start" && p.id === "text-1")).toBe(true)
    expect(
      parts.some((p) => p.type === "text-delta" && p.id === "text-1" && p.delta === "hi"),
    ).toBe(true)
    expect(parts.some((p) => p.type === "text-end" && p.id === "text-1")).toBe(true)
    const finishPart = parts.find((p) => p.type === "finish")
    expect(finishPart).toBeDefined()
    expect(finishPart?.finishReason).toEqual({ unified: "stop", raw: "end_turn" })
  })

  it("repairs orphan tool_use by adding placeholder tool_result in request body", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const sseBody = new TextEncoder().encode(
      "event: message_start\n\n" +
        "event: content_block_start\n" +
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n' +
        "event: content_block_delta\n" +
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n' +
        "event: content_block_stop\n" +
        'data: {"type":"content_block_stop","index":0}\n\n' +
        "event: message_delta\n" +
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    )
    transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sseBody,
    })
    const model = createClaudeLanguageModel({
      modelId: "claude-sonnet-4-6",
      transport,
      readAccessToken: async () => "secret-token",
    })

    // When: prompt includes assistant message with tool_use but no tool_result
    await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "call tool" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-1",
              toolName: "get_weather",
              input: { location: "NYC" },
            },
          ],
        },
      ],
    })

    // Then: request body contains a tool_result placeholder for the orphan tool_use
    const request = transport.requests.at(0)
    expect(request).toBeDefined()
    expect(request?.body).not.toBeNull()
    const requestBody = request?.body
    expect(requestBody).not.toBeNull()
    const body = JSON.parse(new TextDecoder().decode(requestBody ?? new Uint8Array()))
    const assistantMsg = body.messages.find((m: { role: string }) => m.role === "assistant")
    expect(assistantMsg).toBeDefined()
    const toolUseBlock = assistantMsg.content.find((c: { type: string }) => c.type === "tool_use")
    expect(toolUseBlock).toBeDefined()
    // The repair should add a tool_result for the orphan tool_use
    const toolResultBlock = assistantMsg.content.find(
      (c: { type: string }) => c.type === "tool_result",
    )
    expect(toolResultBlock).toBeDefined()
    expect(toolResultBlock.tool_use_id).toBe("tool-1")
    expect(toolResultBlock.is_error).toBe(true)
  })
})
