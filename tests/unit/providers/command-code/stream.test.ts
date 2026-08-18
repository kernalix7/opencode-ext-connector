import { describe, expect, it } from "bun:test"

import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

describe("createCommandCodeLanguageModel doStream", () => {
  it("parses NDJSON incrementally: emits deltas for text-delta with text and data.text variants", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const ndjsonBody = [
      '{"type":"text-delta","text":"a"}',
      '{"type":"text-delta","data":{"text":"b"}}',
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
      '{"type":"text-delta","text":"first"}',
      "",
      '{"type":"text-delta","data":{"text":"second"}}',
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
})
