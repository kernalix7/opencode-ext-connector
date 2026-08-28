import { describe, expect, it } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

import type { OllamaCatalogState, OllamaFetch } from "../../src/providers/ollama"
import { createOllamaLanguageModel } from "../../src/providers/ollama"

const TAGS_URL = "http://localhost:11434/api/tags"
const PULL_URL = "http://localhost:11434/api/pull"
const CHAT_URL = "http://localhost:11434/api/chat"
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
          case "/api/tags":
            return Response.json({ models: this.options.localModels.map((name) => ({ name })) })
          case "/api/pull":
            return fragmentedNdjson([{ status: "pulling manifest" }, { status: "success" }])
          case "/api/chat":
            return fragmentedNdjson([
              { message: { role: "assistant", content: this.options.chatText }, done: false },
              { message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
            ])
          default:
            return new Response(null, { status: 404 })
        }
      },
    })
  }

  public readonly fetch: OllamaFetch = async (url, init): Promise<Response> => {
    this.originalRequests.push(new Request(url, init))
    const mappedUrl = new URL(new URL(url).pathname, this.server.url)
    return fetch(new Request(mappedUrl.href, init))
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
    expect(server.originalRequests.map(({ url }) => url)).toEqual([TAGS_URL, CHAT_URL])
    expect(server.networkRequests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/api/tags",
      "/api/chat",
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
    expect(server.originalRequests.map(({ url }) => url)).toEqual([TAGS_URL, PULL_URL, CHAT_URL])
    expect(server.networkRequests.map(({ method }) => method)).toEqual(["GET", "POST", "POST"])
    expect(text).toEqual(["cloud"])
    expectCredentialFree(server.originalRequests)
    expect(server.networkRequests.every(({ hasAuthorization }) => !hasAuthorization)).toBe(true)
    expect(server.networkRequests.every(({ hasCookie }) => !hasCookie)).toBe(true)
  })
})
