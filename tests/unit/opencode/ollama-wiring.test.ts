import { describe, expect, it } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"

import { parseModelId, parseProviderId } from "../../../src/core/ids"
import type { OpenCodeAuthMatch } from "../../../src/opencode/auth-store"
import { getProductionOllamaBundle } from "../../../src/opencode/ollama-production"
import type { ProviderEntryDeps } from "../../../src/opencode/provider-entry"
import { createProviderRegistry } from "../../../src/opencode/providers"
import { createV1CatalogProjector } from "../../../src/opencode/v1-catalog"
import { createOllamaCatalogState, parseOllamaEndpoints } from "../../../src/providers/ollama"
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
  it("shares normalized production bases and isolates distinct daemon state", () => {
    // Given / When
    const first = getProductionOllamaBundle("HTTPS://daemon.example.test:443/prefix/")
    const equal = getProductionOllamaBundle("https://daemon.example.test/prefix")
    const distinct = getProductionOllamaBundle("https://other.example.test/prefix")
    const lease = first.catalog.acquire()

    // Then
    expect(equal).toBe(first)
    expect(equal.runtime).toBe(first.runtime)
    expect(distinct.runtime).not.toBe(first.runtime)
    expect(first.catalog.activeLeaseCount()).toBe(1)
    expect(distinct.catalog.activeLeaseCount()).toBe(0)
    lease.dispose()
  })

  it("registers Ollama as the fourth provider", () => {
    // Given / When
    const registry = createProviderRegistry()

    // Then
    expect(registry.map(({ id }) => id)).toEqual(["claude", "cursor", "command-code", "ollama"])
  })

  it("projects the normalized configured daemon base and no credential options", () => {
    // Given
    const http = new FakeFetch()
    const endpoints = parseOllamaEndpoints("HTTPS://daemon.example.test:443/prefix/")

    // When
    const entry = createProviderRegistry({
      ollama: {
        fetch: http.fetch,
        catalog: createOllamaCatalogState({ fetch: http.fetch }),
        endpoints,
      },
    }).find(({ id }) => id === "ollama")

    // Then
    expect(entry?.providerOptions).toEqual({
      ollamaBaseURL: "https://daemon.example.test/prefix",
    })
    expect(Object.keys(entry?.providerOptions ?? {})).toEqual(["ollamaBaseURL"])
  })

  it("projects only the normalized Ollama base into V1 provider options", async () => {
    // Given
    const http = new FakeFetch()
    const endpoints = parseOllamaEndpoints("HTTPS://daemon.example.test:443/prefix/")
    const entry = createProviderRegistry({
      ollama: {
        fetch: http.fetch,
        catalog: createOllamaCatalogState({ fetch: http.fetch }),
        endpoints,
      },
    }).find(({ id }) => id === "ollama")
    if (entry === undefined) throw new Error("Ollama registry entry is missing")
    const projector = createV1CatalogProjector({
      entries: [entry],
      npmSpecifiers: { ollama: "file:///ollama" },
    })
    const config: Parameters<NonNullable<Hooks["config"]>>[0] = {}
    projector.attach(config)

    // When
    await projector.publisher.publish(
      {
        status: "ready",
        providerId: parseProviderId("ollama"),
        models: [{ id: parseModelId("local:latest") }],
      },
      new AbortController().signal,
    )

    // Then
    expect(config.provider?.["ollama"]?.options).toEqual({
      ollamaBaseURL: "https://daemon.example.test/prefix",
    })
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
