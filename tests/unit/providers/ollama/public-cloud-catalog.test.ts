import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import { createOllamaCatalogState } from "../../../../src/providers/ollama/catalog-state"
import { discoverOllamaCloudModels } from "../../../../src/providers/ollama/cloud-catalog"
import { OllamaCatalogError } from "../../../../src/providers/ollama/errors"
import { FakeFetch, jsonResponse } from "./http-fake"

const CATALOG = "https://ollama.com/api/tags"
const SIGNAL = new AbortController().signal

function enqueueReference(http: FakeFetch, hosted: string, daemon: string): void {
  const [family, tag] = daemon.split(":")
  const base = `https://registry.ollama.ai/v2/library/${family}`
  const config = JSON.stringify({ remote_host: "https://ollama.com", remote_model: hosted })
  const digest = `sha256:${createHash("sha256").update(config).digest("hex")}`
  http.enqueue(
    `${base}/manifests/${tag}`,
    jsonResponse({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: { digest, size: Buffer.byteLength(config) },
      layers: [],
    }),
  )
  http.enqueue(`${base}/blobs/${digest}`, new Response(config))
}

describe("public Cloud JSON discovery", () => {
  for (const status of [302, 404, 503]) {
    it(`fails the catalog refresh without fallback when the public catalog returns HTTP ${status}`, async () => {
      // Given
      const http = new FakeFetch()
      http.enqueue(CATALOG, jsonResponse({}, status))
      // When
      const promise = discoverOllamaCloudModels(http.fetch, SIGNAL)
      // Then
      await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
      expect(http.requests).toHaveLength(1)
    })
  }

  it("rejects oversized registry metadata without probing another candidate", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(CATALOG, jsonResponse({ models: [{ name: "one" }] }))
    http.enqueue(
      "https://registry.ollama.ai/v2/library/one/manifests/cloud",
      new Response(" ".repeat(16385)),
    )
    // When
    const promise = discoverOllamaCloudModels(http.fetch, SIGNAL)
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    expect(http.requests).toHaveLength(2)
  })

  it("propagates unexpected fetch failures rather than treating them as absent references", async () => {
    // Given
    const http = new FakeFetch()
    const failure = new RangeError("unexpected fixture failure")
    http.enqueue(CATALOG, failure)
    // When
    const promise = discoverOllamaCloudModels(http.fetch, SIGNAL)
    // Then
    await expect(promise).rejects.toBe(failure)
  })

  it("sanitizes transport errors without exposing response or credential text", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(CATALOG, new TypeError("https://secret.test?key=synthetic"))
    // When
    const promise = discoverOllamaCloudModels(http.fetch, SIGNAL)
    // Then
    await expect(promise).rejects.toMatchObject({
      name: "OllamaCatalogError",
      kind: "transport-error",
      message: "Ollama catalog request failed",
    })
  })
  it("discovers nonlocal models while preserving distinct variants and versions", async () => {
    // Given
    const http = new FakeFetch()
    const hosted = ["gpt-oss:120b", "gpt-oss:20b", "deepseek-v4-pro:0813", "minimax-m3"]
    http.enqueue(CATALOG, jsonResponse({ models: hosted.map((name) => ({ name, model: name })) }))
    for (const id of hosted)
      enqueueReference(http, id, id.includes(":") ? `${id}-cloud` : `${id}:cloud`)
    // When
    const models = await discoverOllamaCloudModels(http.fetch, SIGNAL)
    // Then
    expect(models.map(({ id }) => String(id))).toEqual([
      "gpt-oss:120b-cloud",
      "gpt-oss:20b-cloud",
      "deepseek-v4-pro:0813-cloud",
      "minimax-m3:cloud",
    ])
    expect(http.requests[0]?.url).toBe(CATALOG)
    expect(
      http.requests.every(
        ({ init }) =>
          init?.method === "GET" && init.credentials === "omit" && init.redirect === "error",
      ),
    ).toBe(true)
  })

  it("selects a verified family cloud reference when the variant candidate is absent", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(CATALOG, jsonResponse({ models: [{ model: "gemma4:31b" }] }))
    http.enqueue(
      "https://registry.ollama.ai/v2/library/gemma4/manifests/31b-cloud",
      jsonResponse({}, 404),
    )
    enqueueReference(http, "gemma4:31b", "gemma4:cloud")
    // When
    const models = await discoverOllamaCloudModels(http.fetch, SIGNAL)
    // Then
    expect(models.map(({ id }) => String(id))).toEqual(["gemma4:cloud"])
  })

  it("preserves prior complete authorization when a partial refresh cannot resolve every ID", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(CATALOG, jsonResponse({ models: [{ name: "gpt-oss:20b" }] }))
    enqueueReference(http, "gpt-oss:20b", "gpt-oss:20b-cloud")
    const state = createOllamaCatalogState({ fetch: http.fetch })
    await using lease = state.acquire()
    await lease.refresh(SIGNAL)
    http.enqueue(CATALOG, jsonResponse({ models: [{ name: "gpt-oss:120b" }, { name: "unknown" }] }))
    enqueueReference(http, "gpt-oss:120b", "gpt-oss:120b-cloud")
    for (const tag of ["cloud", "latest-cloud"])
      http.enqueue(
        `https://registry.ollama.ai/v2/library/unknown/manifests/${tag}`,
        jsonResponse({}, 404),
      )
    // When
    const promise = lease.refresh(SIGNAL)
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    expect(lease.models().map(({ id }) => String(id))).toEqual(["gpt-oss:20b-cloud"])
    expect(state.authorizesCloudPull("gpt-oss:20b-cloud")).toBe(true)
    expect(state.authorizesCloudPull("gpt-oss:120b-cloud")).toBe(false)
    expect(state.authorizesCloudPull("unknown:cloud")).toBe(false)
  })

  it("bounds concurrent metadata requests when many hosted models are listed", async () => {
    // Given
    const http = new FakeFetch()
    const families = ["one", "two", "three", "four"]
    http.enqueue(CATALOG, jsonResponse({ models: families.map((name) => ({ name })) }))
    for (const family of families) {
      enqueueReference(http, family, `${family}:cloud`)
      http.block(`https://registry.ollama.ai/v2/library/${family}/manifests/cloud`)
    }
    // When
    const promise = discoverOllamaCloudModels(http.fetch, SIGNAL, 2)
    for (const family of families)
      http.release(`https://registry.ollama.ai/v2/library/${family}/manifests/cloud`)
    const models = await promise
    // Then
    expect(models).toHaveLength(4)
    expect(http.maximumActive).toBe(2)
  })

  for (const entry of [{ name: "../escape" }, { name: "one", model: "two" }, {}]) {
    it(`rejects malformed or conflicting catalog IDs ${JSON.stringify(entry)} before registry I/O`, async () => {
      // Given
      const http = new FakeFetch()
      http.enqueue(CATALOG, jsonResponse({ models: [entry] }))
      // When
      const promise = discoverOllamaCloudModels(http.fetch, SIGNAL)
      // Then
      await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
      expect(http.requests).toHaveLength(1)
    })
  }
})
