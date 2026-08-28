import { describe, expect, it } from "bun:test"

import { AdapterError } from "../../../../src/core/errors"
import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

const readCliVersion = (): string => "1.27.1"

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
      readCliVersion,
    })
    // When
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    const request = transport.requests.at(0)
    expect(request?.url).toBe("https://api.commandcode.ai/alpha/generate")
    expect(request?.headers["x-command-code-version"]).toBe("1.27.1")
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

  it("returns native v3 usage from the terminal finish event", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        '{"type":"finish","finishReason":"length","rawFinishReason":"max_tokens","totalUsage":{"inputTokens":10,"outputTokens":6,"inputTokenDetails":{"noCacheTokens":7,"cacheReadTokens":2,"cacheWriteTokens":1},"outputTokenDetails":{"textTokens":4,"reasoningTokens":2}}}',
      ),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })

    // When
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    // Then
    expect(result.finishReason).toEqual({ unified: "length", raw: "max_tokens" })
    expect(result.usage).toEqual({
      inputTokens: { total: 10, noCache: 7, cacheRead: 2, cacheWrite: 1 },
      outputTokens: { total: 6, text: 4, reasoning: 2 },
    })
  })

  it("rejects generation with the structured provider stream error", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        '{"type":"error","error":{"message":"unavailable","code":"MODEL_NOT_AVAILABLE","statusCode":400,"isRetryable":false}}',
      ),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })

    // When
    const generation = model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    // Then
    await expect(generation).rejects.toMatchObject({
      name: "CommandCodeProviderError",
      code: "COMMAND_CODE_PROVIDER_ERROR",
      stage: "ndjson-stream",
      statusCode: 400,
      providerCode: "MODEL_NOT_AVAILABLE",
      retryable: false,
    })
  })

  it("rejects a 429 response with only safe provider metadata", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 429,
      statusText: "Too Many Requests",
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({
          error: {
            message: "account prompt and model details must stay private",
            code: "RATE_LIMITED",
            statusCode: 429,
            isRetryable: true,
          },
          model: "private-model",
        }),
      ),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "private-model",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })

    // When
    const generation = model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "private prompt" }] }],
    })

    // Then
    await expect(generation).rejects.toMatchObject({
      name: "CommandCodeProviderError",
      message: "Command Code provider request failed",
      code: "COMMAND_CODE_PROVIDER_ERROR",
      stage: "http-response",
      statusCode: 429,
      providerCode: "RATE_LIMITED",
      retryable: true,
    })
  })

  it("aborts the lifecycle when an oversized non-success body is rejected", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 413,
      headers: {},
      body: new Uint8Array(64 * 1024 + 1),
    })
    const lifecycleSignal = Promise.withResolvers<AbortSignal>()
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async (signal) => {
        lifecycleSignal.resolve(signal)
        return "cc-token"
      },
      readCliVersion,
    })

    // When
    const generation = model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    // Then
    await expect(generation).rejects.toMatchObject({ reason: "response-body-too-large" })
    expect((await lifecycleSignal.promise).aborted).toBe(true)
  })

  it("rejects a successful response without a body as a typed provider error", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new Uint8Array(),
      bodyPresent: false,
    })
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => "cc-token",
      readCliVersion,
    })

    // When
    const generation = model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    // Then
    await expect(generation).rejects.toMatchObject({
      name: "CommandCodeProviderError",
      code: "COMMAND_CODE_PROVIDER_ERROR",
      stage: "response-body",
      statusCode: 200,
      providerCode: null,
      retryable: false,
    })
  })
})
