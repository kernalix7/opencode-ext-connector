import { describe, expect, it } from "bun:test"

import { createOllamaAdapter, createOllamaCatalogState } from "../../../../src/providers/ollama"
import { FakeFetch, htmlResponse, jsonResponse } from "./http-fake"

const LOCAL_URL = "http://localhost:11434/api/tags"
const SEARCH_URL = "https://ollama.com/search?c=cloud"
const FAMILY_URL = "https://ollama.com/library/shared"

function enqueueComplete(http: FakeFetch, local: readonly string[], cloud: string): void {
  http.enqueue(LOCAL_URL, jsonResponse({ models: local.map((name) => ({ name })) }))
  http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/shared">shared</a>'))
  http.enqueue(FAMILY_URL, htmlResponse(`<a href="/library/${cloud}">cloud</a>`))
}

describe("createOllamaAdapter", () => {
  it("merges local-first with exact dedupe on every scheduler-compatible snapshot", async () => {
    // Given
    const http = new FakeFetch()
    enqueueComplete(http, ["local:latest", "shared:cloud"], "shared:cloud")
    enqueueComplete(http, ["new-local:latest"], "shared:next-cloud")
    const state = createOllamaCatalogState({ fetch: http.fetch })
    const adapter = createOllamaAdapter({ fetch: http.fetch, catalog: state })
    // When
    const first = await adapter.snapshot(new AbortController().signal)
    const second = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(first).toMatchObject({ status: "ready" })
    expect(first.status === "ready" ? first.models.map(({ id }) => String(id)) : []).toEqual([
      "local:latest",
      "shared:cloud",
    ])
    expect(second.status === "ready" ? second.models.map(({ id }) => String(id)) : []).toEqual([
      "new-local:latest",
      "shared:next-cloud",
    ])
  })

  it("merges current local models with prior complete cloud models after cloud failure", async () => {
    // Given
    const http = new FakeFetch()
    enqueueComplete(http, ["local:latest"], "shared:cloud")
    http.enqueue(
      LOCAL_URL,
      jsonResponse({ models: [{ name: "changed:latest" }, { name: "shared:cloud" }] }),
    )
    http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/shared">shared</a>'))
    http.enqueue(FAMILY_URL, htmlResponse("<p>empty</p>"))
    const adapter = createOllamaAdapter({
      fetch: http.fetch,
      catalog: createOllamaCatalogState({ fetch: http.fetch }),
    })
    await adapter.snapshot(new AbortController().signal)
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot.status === "stale" ? snapshot.models.map(({ id }) => String(id)) : []).toEqual([
      "changed:latest",
      "shared:cloud",
    ])
  })

  it("retains the prior complete merged snapshot when local tags fail", async () => {
    // Given
    const http = new FakeFetch()
    enqueueComplete(http, ["local:latest"], "shared:cloud")
    http.enqueue(LOCAL_URL, new TypeError("daemon unavailable"))
    const adapter = createOllamaAdapter({
      fetch: http.fetch,
      catalog: createOllamaCatalogState({ fetch: http.fetch }),
    })
    await adapter.snapshot(new AbortController().signal)
    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)
    // Then
    expect(snapshot.status === "stale" ? snapshot.models.map(({ id }) => String(id)) : []).toEqual([
      "local:latest",
      "shared:cloud",
    ])
  })

  it("releases its provider-local catalog lease when disposed", async () => {
    // Given
    const http = new FakeFetch()
    const state = createOllamaCatalogState({ fetch: http.fetch })
    const adapter = createOllamaAdapter({ fetch: http.fetch, catalog: state })
    expect(state.activeLeaseCount()).toBe(1)
    // When
    await adapter.dispose()
    // Then
    expect(state.activeLeaseCount()).toBe(0)
  })
})
