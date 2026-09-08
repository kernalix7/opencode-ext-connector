import { describe, expect, it } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

import type { OllamaCatalogState, OllamaFetch } from "../../src/providers/ollama"
import { createOllamaLanguageModel, parseOllamaEndpoints } from "../../src/providers/ollama"
import { createOllama } from "../../src/sdk/ollama"

const prompt: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "hello" }] }]

type LoopbackOptions = {
  readonly localModels: readonly string[]
  readonly chatText: string
}

type NetworkRequest = {
  readonly url: string
  readonly method: string
  readonly hasAuthorization: boolean
  readonly hasCookie: boolean
}

function fragmentedNdjson(lines: readonly unknown[]): Response {
  const bytes = new TextEncoder().encode(
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  )
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller): void {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    }),
    { headers: { "content-type": "application/x-ndjson" } },
  )
}

class LoopbackOllama implements AsyncDisposable {
  public readonly originalRequests: Request[] = []
  public readonly networkRequests: NetworkRequest[] = []
  public readonly baseURL: string
  private readonly server: ReturnType<typeof Bun.serve>

  public constructor(private readonly options: LoopbackOptions) {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        this.networkRequests.push({
          url: request.url,
          method: request.method,
          hasAuthorization: request.headers.has("authorization"),
          hasCookie: request.headers.has("cookie"),
        })
        switch (new URL(request.url).pathname) {
          case "/daemon/api/tags":
            return Response.json({ models: this.options.localModels.map((name) => ({ name })) })
          case "/daemon/api/pull":
            return fragmentedNdjson([{ status: "pulling manifest" }, { status: "success" }])
          case "/daemon/api/chat":
            return fragmentedNdjson([
              { message: { role: "assistant", content: this.options.chatText }, done: false },
              { message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
            ])
          default:
            return new Response(null, { status: 404 })
        }
      },
    })
    this.baseURL = new URL("daemon", this.server.url).href.replace(/\/$/u, "")
  }

  public readonly fetch: OllamaFetch = async (url, init): Promise<Response> => {
    this.originalRequests.push(new Request(url, init))
    return fetch(new Request(url, init))
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.server.stop(true)
  }
}

function catalog(authorized: readonly string[]): OllamaCatalogState {
  return {
    acquire: () => {
      throw new TypeError("unexpected catalog lease")
    },
    activeLeaseCount: () => 1,
    authorizesCloudPull: (modelId) => authorized.includes(modelId),
  }
}

async function generate(
  server: LoopbackOllama,
  modelId: string,
  authorized: readonly string[],
): Promise<readonly string[]> {
  const model = createOllamaLanguageModel({
    modelId,
    catalog: catalog(authorized),
    fetch: server.fetch,
    endpoints: parseOllamaEndpoints(server.baseURL),
  })
  const parts = await Array.fromAsync((await model.doStream({ prompt })).stream)
  return parts.flatMap((part) => (part.type === "text-delta" ? [part.delta] : []))
}

function expectCredentialFree(requests: readonly Request[]): void {
  for (const request of requests) {
    expect(request.headers.has("authorization")).toBe(false)
    expect(request.headers.has("cookie")).toBe(false)
  }
}

describe("Ollama real-network generation", () => {
  it("reuses a local tag through tags then fragmented chat without pull or credentials", async () => {
    // Given
    await using server = new LoopbackOllama({ localModels: ["local:latest"], chatText: "hello" })

    // When
    const text = await generate(server, "local:latest", [])

    // Then
    expect(server.originalRequests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/daemon/api/tags",
      "/daemon/api/chat",
    ])
    expect(server.networkRequests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/daemon/api/tags",
      "/daemon/api/chat",
    ])
    expect(text).toEqual(["hello"])
    expectCredentialFree(server.originalRequests)
    expect(server.networkRequests.every(({ hasAuthorization }) => !hasAuthorization)).toBe(true)
    expect(server.networkRequests.every(({ hasCookie }) => !hasCookie)).toBe(true)
  })

  it("pulls an authorized absent cloud tag to success before fragmented chat", async () => {
    // Given
    await using server = new LoopbackOllama({ localModels: [], chatText: "cloud" })

    // When
    const text = await generate(server, "cloud:cloud", ["cloud:cloud"])

    // Then
    expect(server.originalRequests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/daemon/api/tags",
      "/daemon/api/pull",
      "/daemon/api/chat",
    ])
    expect(server.networkRequests.map(({ method }) => method)).toEqual(["GET", "POST", "POST"])
    expect(text).toEqual(["cloud"])
    expectCredentialFree(server.originalRequests)
    expect(server.networkRequests.every(({ hasAuthorization }) => !hasAuthorization)).toBe(true)
    expect(server.networkRequests.every(({ hasCookie }) => !hasCookie)).toBe(true)
  })

  it("routes the standalone SDK through a prefixed loopback daemon without credentials", async () => {
    // Given
    await using server = new LoopbackOllama({ localModels: ["sdk:latest"], chatText: "sdk" })
    const model = createOllama({ ollamaBaseURL: server.baseURL }).languageModel("sdk:latest")

    // When
    const parts = await Array.fromAsync((await model.doStream({ prompt })).stream)

    // Then
    expect(parts.flatMap((part) => (part.type === "text-delta" ? [part.delta] : []))).toEqual([
      "sdk",
    ])
    expect(server.networkRequests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/daemon/api/tags",
      "/daemon/api/chat",
    ])
    expectCredentialFree(server.originalRequests)
  })
})
