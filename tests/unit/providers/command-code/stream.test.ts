import { describe, expect, it } from "bun:test"

import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

const readCliVersion = async (): Promise<string> => "1.27.1"

describe("createCommandCodeLanguageModel doStream", () => {
  it("parses upstream NDJSON text and delta fields incrementally", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const ndjsonBody = [
      '{"type":"start"}',
      '{"type":"text-delta","text":"a"}',
      '{"type":"text-delta","delta":"b"}',
      '{"type":"finish-step","finishReason":"stop","usage":{}}',
      "[DONE]",
    ].join("\n")
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(ndjsonBody),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    const chunks: unknown[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    const textDeltas = chunks.filter(
      (c): c is { type: "text-delta"; id: string; delta: string } =>
        typeof c === "object" && c !== null && "type" in c && c.type === "text-delta",
    )
    expect(textDeltas.map((d) => d.delta)).toEqual(["a", "b"])
  })

  it("handles empty lines and [DONE] gracefully", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const ndjsonBody = [
      "",
      '{"type":"start"}',
      '{"type":"text-delta","text":"first"}',
      "",
      '{"type":"text-delta","delta":"second"}',
      '{"type":"finish-step","finishReason":"stop","usage":{}}',
      "[DONE]",
      "",
    ].join("\n")
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(ndjsonBody),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    const chunks: unknown[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    const textDeltas = chunks.filter(
      (c): c is { type: "text-delta"; id: string; delta: string } =>
        typeof c === "object" && c !== null && "type" in c && c.type === "text-delta",
    )
    expect(textDeltas.map((d) => d.delta)).toEqual(["first", "second"])
  })

  it("preserves UTF-8 characters split across transport chunks", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueChunkedResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"type":"text-delta","text":"한글"}\n'),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const deltas: string[] = []
    for await (const part of stream) {
      if (part.type === "text-delta") {
        deltas.push(part.delta)
      }
    }
    // Then
    expect(deltas).toEqual(["한글"])
  })

  it("emits the upstream tool-call and finish parts", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        [
          '{"type":"start"}',
          '{"type":"tool-call","toolCallId":"t1","toolName":"Read","input":{"path":"a.ts"}}',
          '{"type":"finish-step","finishReason":"tool-calls","usage":{}}',
          '{"type":"finish","finishReason":"tool-calls","rawFinishReason":"tool_calls","totalUsage":{}}',
        ].join("\n"),
      ),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const types: string[] = []
    for await (const chunk of stream) {
      if (typeof chunk === "object" && chunk !== null && "type" in chunk) {
        types.push(chunk.type)
      }
    }
    // Then
    expect(types).toEqual(["stream-start", "tool-call", "finish"])
  })

  it("emits a typed provider error for a string NDJSON error event", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        '{"type":"error","error":"provider prose must not propagate"}\n',
      ),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })

    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const parts = await Array.fromAsync(stream)

    // Then
    expect(parts).toEqual([
      {
        type: "error",
        error: expect.objectContaining({
          name: "CommandCodeProviderError",
          message: "Command Code provider request failed",
          code: "COMMAND_CODE_PROVIDER_ERROR",
          stage: "ndjson-stream",
          statusCode: null,
          providerCode: null,
          retryable: false,
        }),
      },
    ])
  })
})
