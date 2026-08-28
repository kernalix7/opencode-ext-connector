import { describe, expect, it } from "bun:test"

import type { OpenCodeAuthMatch } from "../../../src/opencode/auth-store"
import type { ProviderEntryDeps } from "../../../src/opencode/provider-entry"
import { createProviderRegistry } from "../../../src/opencode/providers"
import { createOllamaCatalogState } from "../../../src/providers/ollama"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { FakeFetch, htmlResponse, jsonResponse } from "../providers/ollama/http-fake"

const LOCAL_URL = "http://localhost:11434/api/tags"
const SEARCH_URL = "https://ollama.com/search?c=cloud"
const FAMILY_URL = "https://ollama.com/library/shared"

function deps(match: OpenCodeAuthMatch | null): ProviderEntryDeps {
  return {
    env: {},
    transport: new FakeHttpTransport(),
    clock: new FakeClock(),
    authStore: { matchAuth: async (provider) => (provider === "ollama" ? match : null) },
    writeBackCredentials: false,
  }
}

describe("Ollama provider registry wiring", () => {
  it("registers Ollama as the fourth provider", () => {
    // Given / When
    const registry = createProviderRegistry()

    // Then
    expect(registry.map(({ id }) => id)).toEqual(["claude", "cursor", "command-code", "ollama"])
  })

  it("checks the marker before probing localhost", async () => {
    // Given
    const http = new FakeFetch()
    const registry = createProviderRegistry({
      ollama: { fetch: http.fetch, catalog: createOllamaCatalogState({ fetch: http.fetch }) },
    })
    const entry = registry.find(({ id }) => id === "ollama")

    // When
    const connected = await entry?.isConnected(deps(null))

    // Then
    expect(connected).toBe(false)
    expect(http.requests).toEqual([])
  })

  it("connects after the exact marker and a successful bounded local tags probe", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(LOCAL_URL, jsonResponse({ models: [] }))
    const registry = createProviderRegistry({
      ollama: { fetch: http.fetch, catalog: createOllamaCatalogState({ fetch: http.fetch }) },
    })
    const entry = registry.find(({ id }) => id === "ollama")

    // When
    const connected = await entry?.isConnected(deps({ kind: "marker" }))

    // Then
    expect(connected).toBe(true)
    expect(http.requests).toEqual([
      {
        url: LOCAL_URL,
        init: {
          method: "GET",
          headers: { accept: "application/json" },
          signal: expect.any(AbortSignal),
          redirect: "error",
          credentials: "omit",
        },
      },
    ])
  })

  it("shares the adapter catalog lease with cloud model authorization and releases it", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(LOCAL_URL, jsonResponse({ models: [] }))
    http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/shared">shared</a>'))
    http.enqueue(FAMILY_URL, htmlResponse('<a href="/library/shared:cloud">cloud</a>'))
    const catalog = createOllamaCatalogState({ fetch: http.fetch })
    const entry = createProviderRegistry({ ollama: { fetch: http.fetch, catalog } }).find(
      ({ id }) => id === "ollama",
    )
    const adapter = entry?.createAdapter(deps({ kind: "marker" }))

    // When
    await adapter?.snapshot(new AbortController().signal)

    // Then
    expect(catalog.authorizesCloudPull("shared:cloud")).toBe(true)
    await adapter?.dispose()
    expect(catalog.authorizesCloudPull("shared:cloud")).toBe(false)
  })
})
