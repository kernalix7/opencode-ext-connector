import { describe, expect, it } from "bun:test"
import { z } from "zod"

import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

const requestBodySchema = z.object({
  threadId: z.string().uuid(),
  params: z.object({ messages: z.array(z.unknown()) }),
})

function enqueueSuccess(transport: FakeHttpTransport): void {
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode('{"type":"finish","finishReason":"stop"}'),
  })
}

function parseRequestBody(
  transport: FakeHttpTransport,
  index: number,
): z.infer<typeof requestBodySchema> {
  const request = transport.requests.at(index)
  if (request?.body === null || request?.body === undefined) {
    throw new Error(`request body ${index} not found`)
  }
  return requestBodySchema.parse(JSON.parse(new TextDecoder().decode(request.body)))
}

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
      readCliVersion: () => "9.8.7",
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
    expect(headers).toMatchObject({
      accept: "application/json, */*",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en-US,en;q=0.9",
      authorization: "Bearer cc-token",
      connection: "keep-alive",
      "content-type": "application/json",
      "user-agent": `commandcode-cli/9.8.7 Node.js/${process.version}`,
      "x-cli-environment": "production",
      "x-co-flag": "false",
      "x-command-code-version": "9.8.7",
      "x-project-slug": "opencode",
      "x-taste-learning": "false",
    })
    expect(headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it("creates a fresh W3C traceparent for each request", async () => {
    // Given
    const transport = new FakeHttpTransport()
    enqueueSuccess(transport)
    enqueueSuccess(transport)
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion: () => "9.8.7",
    })

    // When
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "one" }] }],
    })
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "two" }] }],
    })

    // Then
    const traceparents = transport.requests.map((request) => request.headers["traceparent"])
    expect(traceparents).toHaveLength(2)
    expect(traceparents[0]).not.toBe(traceparents[1])
  })

  it("reuses an injected UUID in the session header and request thread", async () => {
    // Given
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    const transport = new FakeHttpTransport()
    enqueueSuccess(transport)
    enqueueSuccess(transport)
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      generateSessionId: () => sessionId,
    })

    // When
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "one" }] }] })
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "two" }] }] })

    // Then
    expect(transport.requests.map((request) => request.headers["x-session-id"])).toEqual([
      sessionId,
      sessionId,
    ])
    expect([
      parseRequestBody(transport, 0).threadId,
      parseRequestBody(transport, 1).threadId,
    ]).toEqual([sessionId, sessionId])
  })

  it("keeps user images structured beside text and preserves tool turns", async () => {
    // Given
    const transport = new FakeHttpTransport()
    enqueueSuccess(transport)
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      generateSessionId: () => "123e4567-e89b-42d3-a456-426614174000",
    })

    // When
    await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "inspect" },
            { type: "file", data: new Uint8Array([1, 2, 3]), mediaType: "image/png" },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "using tool" },
            { type: "tool-call", toolCallId: "call-1", toolName: "Read", input: { path: "a.ts" } },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "Read",
              output: { type: "text", value: "contents" },
            },
          ],
        },
      ],
    })

    // Then
    expect(parseRequestBody(transport, 0).params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "inspect" },
          { type: "image", image: "data:image/png;base64,AQID", mimeType: "image/png" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "using tool" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "Read",
            input: { path: "a.ts" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "Read",
            output: { type: "text", value: "contents" },
          },
        ],
      },
    ])
  })
})
