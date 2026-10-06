import { describe, expect, it } from "bun:test"

import { createOllamaAdapter, createOllamaCatalogState } from "../../../../src/providers/ollama"
import { cloudManifestUrl, enqueueCloudCatalog, enqueueCloudReference } from "./cloud-fixtures"
import { FakeFetch, jsonResponse } from "./http-fake"

const LOCAL_URL = "http://localhost:11434/api/tags"

function enqueueComplete(
  http: FakeFetch,
  local: readonly string[],
  cloud: { readonly hostedId: string; readonly referenceId: string },
): void {
  http.enqueue(LOCAL_URL, jsonResponse({ models: local.map((name) => ({ name })) }))
  enqueueCloudCatalog(http, [cloud.hostedId])
  enqueueCloudReference(http, cloud)
}

describe("createOllamaAdapter", () => {
  it("merges local-first with exact dedupe on every scheduler-compatible snapshot", async () => {
    // Given
    const http = new FakeFetch()
    enqueueComplete(http, ["local:latest", "shared:cloud"], {
      hostedId: "shared",
      referenceId: "shared:cloud",
    })
    enqueueComplete(http, ["new-local:latest"], {
      hostedId: "shared:next",
      referenceId: "shared:next-cloud",
    })
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
    enqueueComplete(http, ["local:latest"], { hostedId: "shared", referenceId: "shared:cloud" })
    http.enqueue(
      LOCAL_URL,
      jsonResponse({ models: [{ name: "changed:latest" }, { name: "shared:cloud" }] }),
    )
    enqueueCloudCatalog(http, ["shared"])
    http.enqueue(cloudManifestUrl("shared:cloud"), jsonResponse({}, 404))
    http.enqueue(cloudManifestUrl("shared:latest-cloud"), jsonResponse({}, 404))
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
    enqueueComplete(http, ["local:latest"], { hostedId: "shared", referenceId: "shared:cloud" })
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
