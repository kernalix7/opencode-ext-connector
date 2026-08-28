import { describe, expect, it } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

import type { OllamaCatalogState, OllamaFetch } from "../../../../src/providers/ollama"
import { createOllamaLanguageModel, OllamaGenerationError } from "../../../../src/providers/ollama"
import { FakeFetch, jsonResponse } from "./http-fake"

const TAGS_URL = "http://localhost:11434/api/tags"
const PULL_URL = "http://localhost:11434/api/pull"
const CHAT_URL = "http://localhost:11434/api/chat"
const signal = (): AbortSignal => new AbortController().signal

function catalog(authorized: readonly string[]): OllamaCatalogState {
  return {
    acquire: () => {
      throw new TypeError("unexpected catalog lease")
    },
    activeLeaseCount: () => 1,
    authorizesCloudPull: (id) => authorized.includes(id),
  }
}

function model(http: FakeFetch, id: string, authorized: readonly string[] = []) {
  return createOllamaLanguageModel({ modelId: id, catalog: catalog(authorized), fetch: http.fetch })
}

function chatResponse(lines: readonly unknown[]): Response {
  const bytes = new TextEncoder().encode(
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  )
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

const prompt: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "hello" }] }]

describe("Ollama LanguageModelV3 generation", () => {
  it("reuses an exact local tag and sends only fixed-origin tags then chat requests", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(TAGS_URL, jsonResponse({ models: [{ name: "local:latest" }] }))
    http.enqueue(
      CHAT_URL,
      chatResponse([
        { message: { role: "assistant", content: "hi" }, done: false },
        { message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
      ]),
    )
    // When
    const parts = await Array.fromAsync(
      (await model(http, "local:latest").doStream({ prompt })).stream,
    )
    // Then
    expect(http.requests.map(({ url }) => url)).toEqual([TAGS_URL, CHAT_URL])
    expect(parts.map(({ type }) => type)).toEqual([
      "stream-start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ])
    expect(http.requests[1]?.init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { accept: "application/x-ndjson", "content-type": "application/json" },
    })
    expect(await new Response(http.requests[1]?.init?.body).json()).not.toHaveProperty("think")
  })

  it("pulls one authorized absent cloud tag to terminal success before chat", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(TAGS_URL, jsonResponse({ models: [] }))
    http.enqueue(PULL_URL, chatResponse([{ status: "pulling manifest" }, { status: "success" }]))
    http.enqueue(CHAT_URL, chatResponse([{ message: { content: "ok" }, done: true }]))
    // When
    await Array.fromAsync(
      (await model(http, "cloud:cloud", ["cloud:cloud"]).doStream({ prompt })).stream,
    )
    // Then
    expect(http.requests.map(({ url }) => url)).toEqual([TAGS_URL, PULL_URL, CHAT_URL])
    expect(await new Response(http.requests[1]?.init?.body).json()).toEqual({
      model: "cloud:cloud",
      stream: true,
    })
  })

  it("denies an absent model before pull or chat when the current catalog does not authorize it", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(TAGS_URL, jsonResponse({ models: [] }))
    // When
    const result = model(http, "retired:cloud").doStream({ prompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    expect(http.requests.map(({ url }) => url)).toEqual([TAGS_URL])
  })

  it("does not chat when an authorized pull ends without terminal success", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(TAGS_URL, jsonResponse({ models: [] }))
    http.enqueue(PULL_URL, chatResponse([{ status: "pulling manifest" }]))
    // When
    const result = model(http, "cloud:cloud", ["cloud:cloud"]).doStream({ prompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    expect(http.requests.map(({ url }) => url)).toEqual([TAGS_URL, PULL_URL])
  })

  it("consumes fragmented chat NDJSON and doGenerate returns matching content and usage", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(TAGS_URL, jsonResponse({ models: [{ model: "m" }] }))
    http.enqueue(
      CHAT_URL,
      chatResponse([
        { message: { content: "answer", thinking: "reason" }, done: false },
        {
          message: {
            content: "",
            tool_calls: [{ function: { name: "lookup", arguments: { q: 1 } } }],
          },
          done: false,
        },
        {
          message: { content: "" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 4,
          eval_count: 2,
        },
      ]),
    )
    // When
    const generated = await model(http, "m").doGenerate({ prompt })
    // Then
    expect(generated.content).toEqual([
      { type: "reasoning", text: "reason" },
      { type: "text", text: "answer" },
      { type: "tool-call", toolCallId: "ollama-tool-1", toolName: "lookup", input: '{"q":1}' },
    ])
    expect(generated.finishReason).toEqual({ unified: "tool-calls", raw: "stop" })
    expect(generated.usage.inputTokens.total).toBe(4)
    expect(generated.usage.outputTokens.total).toBe(2)
  })

  it("rejects unsupported file prompts before any network call", async () => {
    // Given
    const http = new FakeFetch()
    const filePrompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "file", data: "AA==", mediaType: "image/png" }] },
    ]
    // When
    const result = model(http, "m").doStream({ prompt: filePrompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    expect(http.requests).toEqual([])
  })

  it("maps function tools and tool results into the native Ollama chat request", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(TAGS_URL, jsonResponse({ models: [{ model: "m" }] }))
    http.enqueue(CHAT_URL, chatResponse([{ message: { content: "" }, done: true }]))
    const toolPrompt: LanguageModelV3Prompt = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "lookup", input: { q: 1 } }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "lookup",
            output: { type: "text", value: "found" },
          },
        ],
      },
    ]
    // When
    await Array.fromAsync(
      (
        await model(http, "m").doStream({
          prompt: toolPrompt,
          tools: [{ type: "function", name: "lookup", inputSchema: { type: "object" } }],
          abortSignal: signal(),
        })
      ).stream,
    )
    // Then
    const body = await new Response(http.requests[1]?.init?.body).json()
    expect(body).toMatchObject({
      model: "m",
      stream: true,
      messages: [
        {
          role: "assistant",
          tool_calls: [{ function: { name: "lookup", arguments: { q: 1 } } }],
        },
        { role: "tool", content: "found", tool_name: "lookup" },
      ],
    })
  })

  it("rejects a tool result that precedes its assistant tool call before network", async () => {
    // Given
    const http = new FakeFetch()
    const invalidPrompt: LanguageModelV3Prompt = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "missing",
            toolName: "lookup",
            output: { type: "text", value: "secret result" },
          },
        ],
      },
    ]
    // When
    const result = model(http, "m").doStream({ prompt: invalidPrompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    expect(http.requests).toEqual([])
  })

  it("sanitizes transport failures without exposing provider response text", async () => {
    // Given
    const fetch: OllamaFetch = async () => {
      throw new Error("private provider response and prompt")
    }
    const languageModel = createOllamaLanguageModel({ modelId: "m", catalog: catalog([]), fetch })
    // When
    const result = languageModel.doStream({ prompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    await expect(result).rejects.not.toThrow("private provider response and prompt")
  })
})
