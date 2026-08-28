import { describe, expect, it } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

import type { OllamaCatalogState } from "../../../../src/providers/ollama"
import { createOllamaLanguageModel, type OllamaFetch } from "../../../../src/providers/ollama"
import { FakeFetch, jsonResponse } from "./http-fake"

const TAGS_URL = "http://localhost:11434/api/tags"
const PULL_URL = "http://localhost:11434/api/pull"
const CHAT_URL = "http://localhost:11434/api/chat"
const prompt: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
const catalog: OllamaCatalogState = {
  acquire: () => {
    throw new TypeError("unexpected catalog lease")
  },
  activeLeaseCount: () => 1,
  authorizesCloudPull: (id) => id === "m:cloud",
}

function ndjson(value: unknown): Response {
  return new Response(`${JSON.stringify(value)}\n`)
}

describe("Ollama pull coordination", () => {
  it("shares one pull across concurrent callers for the same absent cloud model", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(TAGS_URL, jsonResponse({ models: [] }))
    http.enqueue(TAGS_URL, jsonResponse({ models: [] }))
    http.enqueue(PULL_URL, ndjson({ status: "success" }))
    http.block(PULL_URL)
    http.enqueue(CHAT_URL, ndjson({ message: { content: "one" }, done: true }))
    http.enqueue(CHAT_URL, ndjson({ message: { content: "two" }, done: true }))
    const model = createOllamaLanguageModel({ modelId: "m:cloud", catalog, fetch: http.fetch })
    // When
    const first = model.doStream({ prompt })
    const second = model.doStream({ prompt })
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    http.release(PULL_URL)
    await Promise.all([first, second])
    // Then
    expect(http.requests.filter(({ url }) => url === PULL_URL)).toHaveLength(1)
  })

  it("lets one pull waiter cancel independently without cancelling the shared pull", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(TAGS_URL, jsonResponse({ models: [] }))
    http.enqueue(TAGS_URL, jsonResponse({ models: [] }))
    http.enqueue(PULL_URL, ndjson({ status: "success" }))
    http.block(PULL_URL)
    http.enqueue(CHAT_URL, ndjson({ message: { content: "ok" }, done: true }))
    const model = createOllamaLanguageModel({ modelId: "m:cloud", catalog, fetch: http.fetch })
    const cancelled = new AbortController()
    const first = model.doStream({ prompt, abortSignal: cancelled.signal })
    const second = model.doStream({ prompt })
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    // When
    cancelled.abort()
    http.release(PULL_URL)
    // Then
    await expect(first).rejects.toMatchObject({ code: "operation-cancelled" })
    await expect(second).resolves.toBeDefined()
    expect(http.requests.filter(({ url }) => url === PULL_URL)).toHaveLength(1)
  })

  it("aborts and replaces a pull after every waiter cancels without late deletion races", async () => {
    // Given
    const oldPull = Promise.withResolvers<Response>()
    const replacementPull = Promise.withResolvers<Response>()
    const firstPullStarted = Promise.withResolvers<void>()
    const replacementStarted = Promise.withResolvers<void>()
    const pullSignals: AbortSignal[] = []
    let pullCount = 0
    const fetch: OllamaFetch = async (url, init) => {
      if (url === TAGS_URL) return jsonResponse({ models: [] })
      if (url === CHAT_URL) return ndjson({ message: { content: "ok" }, done: true })
      if (url !== PULL_URL) throw new TypeError("unexpected test URL")
      pullCount += 1
      if (init?.signal !== null && init?.signal !== undefined) pullSignals.push(init.signal)
      if (pullCount === 1) {
        firstPullStarted.resolve()
        return oldPull.promise
      }
      replacementStarted.resolve()
      return replacementPull.promise
    }
    const model = createOllamaLanguageModel({ modelId: "m:cloud", catalog, fetch })
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const first = model.doStream({ prompt, abortSignal: firstAbort.signal })
    const second = model.doStream({ prompt, abortSignal: secondAbort.signal })
    const firstObserved = first.then(
      () => null,
      (error: unknown) => error,
    )
    const secondObserved = second.then(
      () => null,
      (error: unknown) => error,
    )
    await firstPullStarted.promise
    await Promise.resolve()
    // When
    firstAbort.abort()
    secondAbort.abort()
    expect(await firstObserved).toMatchObject({ code: "operation-cancelled" })
    expect(await secondObserved).toMatchObject({ code: "operation-cancelled" })
    const third = model.doStream({ prompt })
    await replacementStarted.promise
    oldPull.resolve(ndjson({ status: "success" }))
    await Promise.resolve()
    await Promise.resolve()
    const fourth = model.doStream({ prompt })
    replacementPull.resolve(ndjson({ status: "success" }))
    const streams = await Promise.all([third, fourth])
    await Promise.all(streams.map(({ stream }) => stream.cancel()))
    // Then
    expect(pullSignals[0]?.aborted).toBe(true)
    expect(pullCount).toBe(2)
  })
})
