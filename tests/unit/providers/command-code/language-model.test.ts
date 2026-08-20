import { describe, expect, it } from "bun:test"

import { AdapterError } from "../../../../src/core/errors"
import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

describe("createCommandCodeLanguageModel", () => {
  it("posts /alpha/generate with CLI headers and parses NDJSON text", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        [
          '{"type":"start"}',
          '{"type":"text-delta","text":"hello"}',
          '{"type":"text-delta","delta":" world"}',
          '{"type":"finish-step","finishReason":"stop","usage":{}}',
        ].join("\n"),
      ),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
    })
    // When
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    const request = transport.requests.at(0)
    expect(request?.url).toBe("https://api.commandcode.ai/alpha/generate")
    expect(request?.headers["x-command-code-version"]).toBeDefined()
    expect(result.content).toEqual([{ type: "text", text: "hello world" }])
  })

  it("fails without credentials", async () => {
    // Given
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport: new FakeHttpTransport(),
      readAccessToken: async () => null,
    })
    // When
    const promise = model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    await expect(promise).rejects.toBeInstanceOf(AdapterError)
  })
})
