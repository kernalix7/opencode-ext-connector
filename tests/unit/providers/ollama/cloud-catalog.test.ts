import { describe, expect, it } from "bun:test"

import {
  createOllamaCatalogState,
  discoverOllamaCloudModels,
  OllamaCatalogError,
} from "../../../../src/providers/ollama"
import { cloudManifestUrl, enqueueCloudCatalog, enqueueCloudReference } from "./cloud-fixtures"
import { FakeFetch, jsonResponse } from "./http-fake"

describe("discoverOllamaCloudModels", () => {
  it("discovers exact cloud tags from digest-verified remote metadata", async () => {
    // Given
    const http = new FakeFetch()
    enqueueCloudCatalog(http, ["glm-5.3-flash"])
    enqueueCloudReference(http, { hostedId: "glm-5.3-flash", referenceId: "glm-5.3-flash:cloud" })
    // When
    const models = await discoverOllamaCloudModels(http.fetch, new AbortController().signal)
    // Then
    expect(models.map(({ id }) => String(id))).toEqual(["glm-5.3-flash:cloud"])
  })

  it("includes tags ending in -cloud and deduplicates exact IDs", async () => {
    // Given
    const http = new FakeFetch()
    enqueueCloudCatalog(http, ["gpt-oss:120b", "gpt-oss:120b"])
    enqueueCloudReference(http, { hostedId: "gpt-oss:120b", referenceId: "gpt-oss:120b-cloud" })
    // When
    const models = await discoverOllamaCloudModels(http.fetch, new AbortController().signal)
    // Then
    expect(models.map(({ id }) => String(id))).toEqual(["gpt-oss:120b-cloud"])
  })

  it("bounds concurrent reference fetches", async () => {
    // Given
    const http = new FakeFetch()
    const families = ["one", "two", "three", "four"]
    enqueueCloudCatalog(http, families)
    for (const family of families) {
      const url = cloudManifestUrl(`${family}:cloud`)
      enqueueCloudReference(http, { hostedId: family, referenceId: `${family}:cloud` })
      http.block(url)
    }
    const promise = discoverOllamaCloudModels(http.fetch, new AbortController().signal, 2)
    await http.waitForRequest(cloudManifestUrl("one:cloud"))
    await http.waitForRequest(cloudManifestUrl("two:cloud"))
    // When
    for (const family of families) http.release(cloudManifestUrl(`${family}:cloud`))
    const models = await promise
    // Then
    expect(models).toHaveLength(4)
    expect(http.maximumActive).toBe(2)
  })

  it("rejects the complete refresh when any hosted model has no resolved reference", async () => {
    // Given
    const http = new FakeFetch()
    enqueueCloudCatalog(http, ["one", "two"])
    enqueueCloudReference(http, { hostedId: "one", referenceId: "one:cloud" })
    http.enqueue(cloudManifestUrl("two:cloud"), jsonResponse({}, 404))
    http.enqueue(cloudManifestUrl("two:latest-cloud"), jsonResponse({}, 404))
    // When
    const promise = discoverOllamaCloudModels(http.fetch, new AbortController().signal)
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
  })
})

describe("OllamaCatalogState", () => {
  it("publishes additions and retirements only after complete successful refreshes", async () => {
    // Given
    const http = new FakeFetch()
    enqueueCloudCatalog(http, ["one"])
    enqueueCloudReference(http, { hostedId: "one", referenceId: "one:cloud" })
    enqueueCloudCatalog(http, ["two"])
    enqueueCloudReference(http, { hostedId: "two", referenceId: "two:cloud" })
    const state = createOllamaCatalogState({ fetch: http.fetch })
    const lease = state.acquire()
    await lease.refresh(new AbortController().signal)
    // When
    await lease.refresh(new AbortController().signal)
    // Then
    expect(lease.models().map(({ id }) => String(id))).toEqual(["two:cloud"])
    expect(state.authorizesCloudPull("two:cloud")).toBe(true)
    expect(state.authorizesCloudPull("one:cloud")).toBe(false)
  })

  it("atomically retains the previous complete catalog on refresh failure", async () => {
    // Given
    const http = new FakeFetch()
    enqueueCloudCatalog(http, ["one"])
    enqueueCloudReference(http, { hostedId: "one", referenceId: "one:cloud" })
    enqueueCloudCatalog(http, ["two"])
    http.enqueue(cloudManifestUrl("two:cloud"), jsonResponse({ schemaVersion: 2, layers: [] }))
    const lease = createOllamaCatalogState({ fetch: http.fetch }).acquire()
    await lease.refresh(new AbortController().signal)
    // When
    const promise = lease.refresh(new AbortController().signal)
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    expect(lease.models().map(({ id }) => String(id))).toEqual(["one:cloud"])
  })

  it("keeps shared authorization until the last active lease is disposed", async () => {
    // Given
    const http = new FakeFetch()
    enqueueCloudCatalog(http, ["one"])
    enqueueCloudReference(http, { hostedId: "one", referenceId: "one:cloud" })
    const state = createOllamaCatalogState({ fetch: http.fetch })
    const first = state.acquire()
    const second = state.acquire()
    await first.refresh(new AbortController().signal)
    expect(state.authorizesCloudPull("one:cloud")).toBe(true)
    // When
    await first.dispose()
    // Then
    expect(state.authorizesCloudPull("one:cloud")).toBe(true)
    await second.dispose()
    expect(state.authorizesCloudPull("one:cloud")).toBe(false)
  })
})
