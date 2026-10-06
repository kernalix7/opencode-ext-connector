import { describe, expect, it } from "bun:test"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../../../src/core/errors"
import type { HttpResponse } from "../../../../src/core/http"
import { parseModelId, parseProviderId } from "../../../../src/core/ids"
import { createCommandCodeAdapter } from "../../../../src/providers/command-code/api-adapter"
import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/api-language-model"
import { listCommandCodeCapabilities } from "../../../../src/providers/command-code/api-models"
import { FakeHttpTransport } from "../../../support/http"

const base = "https://api.commandcode.ai/provider/v1"
const prompt: LanguageModelV3CallOptions["prompt"] = [
  { role: "user", content: [{ type: "text", text: "fixture" }] },
]

function jsonResponse(value: unknown): HttpResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify(value)),
  }
}

function catalogResponse(route: string): HttpResponse {
  return jsonResponse({
    data: [{ id: "fixture-model", supported_endpoints: [`/provider/v1/${route}`] }],
  })
}

const generationCases = [
  {
    route: "chat/completions",
    text: "chat-ok",
    response: {
      id: "chatcmpl_fixture",
      object: "chat.completion",
      created: 1700000000,
      model: "fixture-model",
      choices: [
        { index: 0, message: { role: "assistant", content: "chat-ok" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    },
  },
  {
    route: "messages",
    text: "messages-ok",
    response: {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "fixture-model",
      content: [{ type: "text", text: "messages-ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 4, output_tokens: 2 },
    },
  },
  {
    route: "responses",
    text: "responses-ok",
    response: {
      id: "resp_fixture",
      object: "response",
      created_at: 1700000000,
      status: "completed",
      model: "fixture-model",
      output: [
        {
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "responses-ok", annotations: [] }],
        },
      ],
      usage: {
        input_tokens: 4,
        output_tokens: 2,
        total_tokens: 6,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      error: null,
      incomplete_details: null,
    },
  },
] as const

describe("official Command Code wire contracts", () => {
  it.each([...generationCases])("generates through the advertised $route SDK", async (row) => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(catalogResponse(row.route))
    transport.enqueueResponse(jsonResponse(row.response))
    const model = createCommandCodeLanguageModel({
      modelId: "fixture-model",
      transport,
      readApiKey: async () => "fixture-api-key",
    })
    // When
    const result = await model.doGenerate({ prompt, maxOutputTokens: 16 })
    // Then
    expect(result.content).toContainEqual(expect.objectContaining({ type: "text", text: row.text }))
    expect(result.usage.inputTokens.total).toBe(4)
    expect(result.usage.outputTokens.total).toBe(2)
    expect(transport.requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: `${base}/models` },
      { method: "POST", url: `${base}/${row.route}` },
    ])
    const request = transport.requests[1]
    expect(
      row.route === "messages" ? request?.headers["x-api-key"] : request?.headers["authorization"],
    ).toBe(row.route === "messages" ? "fixture-api-key" : "Bearer fixture-api-key")
  })

  it("selects capabilities without inferring them from model names", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(
      jsonResponse({
        data: [
          {
            id: "claude-looking",
            supported_endpoints: ["/provider/v1/responses", "/provider/v1/chat/completions"],
          },
          { id: "other", supported_endpoints: [`${base}/messages`] },
          { id: "decision", supported_endpoints: ["/provider/v1/systemone"] },
        ],
      }),
    )
    // When
    const result = await listCommandCodeCapabilities({
      transport,
      apiKey: "fixture-api-key",
      signal: new AbortController().signal,
    })
    // Then
    expect(result).toEqual([
      { model: { id: parseModelId("claude-looking") }, endpoint: "chat" },
      { model: { id: parseModelId("other") }, endpoint: "messages" },
    ])
  })

  it("does not generate when endpoint metadata is unknown", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(catalogResponse("unsupported"))
    const model = createCommandCodeLanguageModel({
      modelId: "fixture-model",
      transport,
      readApiKey: async () => "fixture-api-key",
    })
    // When
    const result = model.doGenerate({ prompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(AdapterError)
    expect(transport.requests.map(({ method }) => method)).toEqual(["GET"])
  })

  it("rejects missing credentials before any request", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const model = createCommandCodeLanguageModel({
      modelId: "fixture-model",
      transport,
      readApiKey: async () => null,
    })
    // When
    const result = model.doGenerate({ prompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(AdapterError)
    expect(transport.requests).toHaveLength(0)
  })

  it("rejects already-aborted streaming before any request", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const signal = AbortSignal.abort()
    const model = createCommandCodeLanguageModel({
      modelId: "fixture-model",
      transport,
      readApiKey: async () => "fixture-api-key",
    })
    // When
    const result = model.doStream({ prompt, abortSignal: signal })
    // Then
    await expect(result).rejects.toBeInstanceOf(OperationCancelledError)
    expect(transport.requests).toHaveLength(0)
  })

  it("does not retain another key's catalog after a failed refresh", async () => {
    // Given
    let key = "fixture-a"
    let available = true
    const adapter = createCommandCodeAdapter({
      readApiKey: async () => key,
      listModels: async () => {
        if (!available)
          throw new AdapterError({
            operation: "fixture-catalog",
            providerId: parseProviderId("command-code"),
            retryable: true,
            cause: null,
          })
        return [{ id: parseModelId("account-a-model") }]
      },
    })
    await adapter.snapshot(new AbortController().signal)
    key = "fixture-b"
    available = false
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot).toMatchObject({ status: "unavailable" })
  })
})
