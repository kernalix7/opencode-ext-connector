import { describe, expect, it } from "bun:test"

import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

describe("createCommandCodeLanguageModel request shape", () => {
  it("posts /alpha/generate with the upstream config and params envelope", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"type":"text-delta","text":"ok"}'),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
    })
    // When
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    const request = transport.requests.at(0)
    expect(request).toBeDefined()
    if (request === undefined) {
      throw new Error("request not found")
    }
    const requestBody = request.body
    expect(requestBody).toBeDefined()
    if (requestBody === null || requestBody === undefined) {
      throw new Error("request body not found")
    }
    const body = JSON.parse(new TextDecoder().decode(requestBody))
    expect(typeof body.config.workingDir).toBe("string")
    expect(typeof body.memory).toBe("string")
    expect(typeof body.taste).toBe("string")
    expect(body.skills).toBeNull()
    expect(body).toHaveProperty("permissionMode")
    expect(body).toHaveProperty("params")
    expect(body.params).toHaveProperty("stream", true)
    expect(body.params).toHaveProperty("model", "default")
    expect(body.params).toHaveProperty("messages")
    expect(body.params).toHaveProperty("tools")
    expect(body.params).toHaveProperty("system")
    expect(body.params).toHaveProperty("max_tokens", 16_384)
  })

  it("includes the upstream CLI headers with the detected version", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"type":"text-delta","text":"ok"}'),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
    })
    // When
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    const request = transport.requests.at(0)
    expect(request).toBeDefined()
    if (request === undefined) {
      throw new Error("request not found")
    }
    const headers = request.headers
    expect(headers["x-cli-environment"]).toBe("production")
    expect(headers["x-command-code-version"]).toBeDefined()
    expect(headers["authorization"]).toBe("Bearer cc-token")
    expect(headers["x-project-slug"]).toBe("opencode")
  })
})
