import { describe, expect, it } from "bun:test"
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { z } from "zod"

import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/api-language-model"
import { FakeHttpTransport } from "../../../support/http"
import { chatToolEvents, sseResponse, textStreams } from "./api-stream-fixtures"

const base = "https://api.commandcode.ai/provider/v1"
const prompt: LanguageModelV3CallOptions["prompt"] = [
  { role: "user", content: [{ type: "text", text: "fixture" }] },
]

function scriptedModel(route: string, events: readonly unknown[]) {
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(
      JSON.stringify({
        data: [{ id: "fixture-model", supported_endpoints: [`${base}/${route}`] }],
      }),
    ),
  })
  transport.enqueueChunkedResponse(sseResponse(events))
  const model = createCommandCodeLanguageModel({
    modelId: "fixture-model",
    transport,
    readApiKey: async () => "fixture-api-key",
  })
  return { model, transport }
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of stream) parts.push(part)
  return parts
}

describe("official Command Code streaming wire contracts", () => {
  it.each([...textStreams])(
    "streams text and terminal usage when $route is advertised",
    async (row) => {
      // Given: the same neutral model ID advertises a different route in each case.
      const { model, transport } = scriptedModel(row.route, row.events)

      // When
      const result = await model.doStream({ prompt, maxOutputTokens: 16 })
      const parts = await collect(result.stream)

      // Then
      expect(parts.filter((part) => part.type === "error")).toEqual([])
      expect(
        parts
          .filter((part) => part.type === "text-delta")
          .map((part) => part.delta)
          .join(""),
      ).toBe("wire-ok")
      expect(parts.filter((part) => part.type === "text-start")).toHaveLength(1)
      expect(parts.filter((part) => part.type === "text-end")).toHaveLength(1)
      expect(parts.filter((part) => part.type === "finish")).toHaveLength(1)
      expect(parts.at(-1)).toMatchObject({
        type: "finish",
        finishReason: { unified: "stop" },
        usage: { inputTokens: { total: 4 }, outputTokens: { total: 2 } },
      })
      expect(transport.requests.map(({ method, url }) => ({ method, url }))).toEqual([
        { method: "GET", url: `${base}/models` },
        { method: "POST", url: `${base}/${row.route}` },
      ])
      const body: unknown = JSON.parse(
        new TextDecoder().decode(transport.requests[1]?.body ?? undefined),
      )
      expect(z.object({ model: z.string(), stream: z.boolean() }).parse(body)).toEqual({
        model: "fixture-model",
        stream: true,
      })
    },
  )

  it("returns a declared function call as V3 parts when chat streams fragmented arguments", async () => {
    // Given: a declaration has no executor, and a previous result is input only.
    const { model, transport } = scriptedModel("chat/completions", chatToolEvents)
    const call: LanguageModelV3CallOptions = {
      prompt: [
        ...prompt,
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_previous",
              toolName: "lookup",
              input: { key: "previous" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_previous",
              toolName: "lookup",
              output: { type: "text", value: "previous-value" },
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          name: "lookup",
          inputSchema: {
            type: "object",
            properties: { key: { type: "string" } },
            required: ["key"],
            additionalProperties: false,
          },
        },
      ],
      toolChoice: { type: "tool", toolName: "lookup" },
    }

    // When
    const result = await model.doStream(call)
    const parts = await collect(result.stream)

    // Then
    expect(parts.filter((part) => part.type === "error")).toEqual([])
    const calls = parts.filter((part) => part.type === "tool-call")
    expect(calls).toMatchObject([
      { type: "tool-call", toolCallId: "call_next", toolName: "lookup", input: '{"key":"next"}' },
    ])
    expect(calls.every((part) => part.providerExecuted !== true)).toBe(true)
    expect(parts.filter((part) => part.type === "tool-result")).toEqual([])
    expect(
      parts
        .filter((part) => part.type === "tool-input-delta")
        .map((part) => part.delta)
        .join(""),
    ).toBe('{"key":"next"}')
    expect(parts.at(-1)).toMatchObject({
      type: "finish",
      finishReason: { unified: "tool-calls" },
      usage: { inputTokens: { total: 9 }, outputTokens: { total: 3 } },
    })
    expect(transport.requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: `${base}/models` },
      { method: "POST", url: `${base}/chat/completions` },
    ])
    const body: unknown = JSON.parse(
      new TextDecoder().decode(transport.requests[1]?.body ?? undefined),
    )
    const request = z
      .object({
        tools: z.array(z.unknown()),
        tool_choice: z.unknown(),
        messages: z.array(z.unknown()),
      })
      .parse(body)
    expect(request.tools).toMatchObject([
      {
        type: "function",
        function: {
          name: "lookup",
          parameters: {
            type: "object",
            properties: { key: { type: "string" } },
            required: ["key"],
            additionalProperties: false,
          },
        },
      },
    ])
    expect(request.tool_choice).toEqual({ type: "function", function: { name: "lookup" } })
    expect(request.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call_previous",
      content: "previous-value",
    })
  })
})
