import { describe, expect, it } from "bun:test"

import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

describe("Command Code request header merging", () => {
  it("normalizes names and applies generated then model then call precedence", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"type":"finish","finishReason":"stop"}'),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "generated-token",
      readCliVersion: async () => "1.27.1",
      headers: {
        "User-Agent": "model-agent",
        "X-Layer": "model-first",
        "x-layer": "model-later",
        "X-Value": "model-value",
      },
    })

    // When
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      headers: {
        AUTHORIZATION: "call-first",
        Authorization: "call-later",
        "X-Layer": "call-value",
        "x-undefined": undefined,
        "X-Value": "  unchanged value  ",
      },
    })

    // Then
    const headers = transport.requests.at(0)?.headers
    expect(headers).toBeDefined()
    expect(Object.keys(headers ?? {}).every((name) => name === name.toLowerCase())).toBe(true)
    expect(Object.keys(headers ?? {}).filter((name) => name === "authorization")).toHaveLength(1)
    expect(headers?.["authorization"]).toBe("call-later")
    expect(headers?.["user-agent"]).toBe("model-agent")
    expect(headers?.["x-layer"]).toBe("call-value")
    expect(headers?.["x-value"]).toBe("  unchanged value  ")
    expect(headers).not.toHaveProperty("x-undefined")
  })
})
