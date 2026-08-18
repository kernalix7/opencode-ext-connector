import { describe, expect, it } from "bun:test"

import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

describe("createCommandCodeLanguageModel request shape", () => {
  it("posts /alpha/generate with full CLI body: config, memory, taste, skills, permissionMode, threadId, params.stream=true", async () => {
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
    expect(body).toHaveProperty("config")
    expect(body).toHaveProperty("memory")
    expect(body).toHaveProperty("taste")
    expect(body).toHaveProperty("skills")
    expect(body).toHaveProperty("permissionMode")
    expect(body).toHaveProperty("threadId")
    expect(body).toHaveProperty("params")
    expect(body.params).toHaveProperty("stream", true)
    expect(body.params).toHaveProperty("model", "default")
    expect(body.params).toHaveProperty("messages")
  })

  it("includes required CLI headers: x-cli-environment, x-session-id, x-project-slug, traceparent", async () => {
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
    expect(headers["user-agent"]?.startsWith("commandcode-cli/")).toBe(true)
    expect(headers["x-cli-environment"]).toBeDefined()
    expect(headers["x-session-id"]).toBeDefined()
    expect(headers["x-command-code-version"]).toBeDefined()
    expect(headers["authorization"]).toBe("Bearer cc-token")
    expect(headers["x-project-slug"]).toBeDefined()
    expect(headers["traceparent"]).toBeDefined()
  })
})
