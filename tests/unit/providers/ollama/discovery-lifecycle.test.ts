import { expect, it } from "bun:test"

import { createOllamaAdapter } from "../../../../src/providers/ollama/adapter"
import { createOllamaCatalogState } from "../../../../src/providers/ollama/catalog-state"
import { discoverOllamaCloudReferences } from "../../../../src/providers/ollama/cloud-catalog"
import { OllamaCatalogError } from "../../../../src/providers/ollama/errors"
import { cloudManifestUrl, enqueueCloudCatalog, enqueueCloudReference } from "./cloud-fixtures"
import { jsonResponse } from "./http-fake"
import { LifecycleFetch } from "./lifecycle-fetch"

function fixture() {
  const http = new LifecycleFetch()
  const caller = new AbortController()
  const bad = cloudManifestUrl("bad:cloud")
  const siblings = ["two", "three", "four"].map((id) => cloudManifestUrl(`${id}:cloud`))
  const failure = new OllamaCatalogError("cloud-family", "transport-error")
  enqueueCloudCatalog(http.replies, ["bad", "two", "three", "four", "five"])
  http.replies.enqueue(bad, failure)
  http.block(bad)
  for (const family of ["two", "three", "four", "five"]) {
    enqueueCloudReference(http.replies, { hostedId: family, referenceId: `${family}:cloud` })
    http.block(cloudManifestUrl(`${family}:cloud`))
  }
  return { http, caller, bad, siblings, failure }
}

it("settles sibling requests before reporting an unavailable direct snapshot when a worker fails", async () => {
  // Given: four active workers and a fifth queued hosted ID.
  const f = fixture()
  const catalog = createOllamaCatalogState({ fetch: f.http.fetch })
  const adapter = createOllamaAdapter({ catalog, fetch: f.http.fetch })
  f.http.replies.enqueue("http://localhost:11434/api/tags", jsonResponse({ models: [] }))
  const snapshot = adapter.snapshot(f.caller.signal)
  try {
    await Promise.all([f.http.started(f.bad), ...f.siblings.map((url) => f.http.started(url))])
    // When
    f.http.release(f.bad)
    const result = await snapshot
    // Then: observe settlement, never wait for the forbidden fifth request.
    expect(result.status).toBe("unavailable")
    expect(f.http.active.size).toBe(0)
    expect(f.http.requests.some(({ url }) => url === cloudManifestUrl("five:cloud"))).toBe(false)
    expect(f.http.requests.some(({ url }) => url.includes("/blobs/"))).toBe(false)
    expect(f.caller.signal.aborted).toBe(false)
    expect(f.siblings.every((url) => f.http.aborts.has(url))).toBe(true)
  } finally {
    f.caller.abort()
    for (const url of f.siblings) f.http.release(url)
    await snapshot
    await adapter.dispose()
  }
})

it("joins asynchronous sibling cleanup and preserves the original typed worker failure", async () => {
  // Given
  const f = fixture()
  for (const url of f.siblings) f.http.blockCleanup(url)
  const settled = Promise.withResolvers<unknown>()
  const operation = discoverOllamaCloudReferences(f.http.fetch, f.caller.signal)
  let completed = false
  operation.then(
    () => {
      completed = true
      settled.resolve(null)
    },
    (error: unknown) => {
      completed = true
      settled.resolve(error)
    },
  )
  try {
    await Promise.all([f.http.started(f.bad), ...f.siblings.map((url) => f.http.started(url))])
    // When
    f.http.release(f.bad)
    // RED can settle without abort; GREEN notifies cancellation before cleanup finishes.
    await Promise.race([settled.promise, Promise.all(f.siblings.map((url) => f.http.aborted(url)))])
    // Then
    expect(completed).toBe(false)
    expect(f.http.active.size).toBe(3)
    for (const url of f.siblings) f.http.release(url)
    expect(await settled.promise).toBe(f.failure)
    expect(f.http.active.size).toBe(0)
    expect(f.caller.signal.aborted).toBe(false)
    expect(
      f.http.requests.some(
        ({ url }) => url.includes("/blobs/") || url === cloudManifestUrl("five:cloud"),
      ),
    ).toBe(false)
  } finally {
    f.caller.abort()
    for (const url of f.siblings) f.http.release(url)
    await settled.promise
  }
})
