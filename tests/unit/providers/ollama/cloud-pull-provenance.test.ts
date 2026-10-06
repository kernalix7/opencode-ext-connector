import { describe, expect, it } from "bun:test"

import { createOllamaCatalogState } from "../../../../src/providers/ollama/catalog-state"
import { parseOllamaEndpoints } from "../../../../src/providers/ollama/endpoints"
import { OllamaCatalogError, OllamaGenerationError } from "../../../../src/providers/ollama/errors"
import { createOllamaRuntime } from "../../../../src/providers/ollama/runtime"
import { cloudManifestUrl, enqueueCloudCatalog, enqueueCloudReference } from "./cloud-fixtures"
import { FakeFetch, jsonResponse } from "./http-fake"

const SIGNAL = new AbortController().signal
const REFERENCE = { hostedId: "gemma4:31b", referenceId: "gemma4:cloud" } as const
const SELECTED = cloudManifestUrl(REFERENCE.referenceId)
const ALTERNATE = cloudManifestUrl("gemma4:31b-cloud")
const ENDPOINTS = parseOllamaEndpoints("https://daemon.example.test/prefix")

async function fixture() {
  const http = new FakeFetch()
  enqueueCloudCatalog(http, [REFERENCE.hostedId])
  http.enqueue(ALTERNATE, jsonResponse({}, 404))
  enqueueCloudReference(http, REFERENCE)
  const state = createOllamaCatalogState({ fetch: http.fetch })
  const lease = state.acquire()
  await lease.refresh(SIGNAL)
  http.requests.length = 0
  http.enqueue(ENDPOINTS.tagsURL, jsonResponse({ models: [] }))
  const runtime = createOllamaRuntime({ catalog: state, fetch: http.fetch, endpoints: ENDPOINTS })
  return { http, lease, runtime }
}

describe("Cloud pull provenance", () => {
  it("revalidates the selected family alias against its original hosted variant before configured-daemon pull", async () => {
    // Given
    const { http, lease, runtime } = await fixture()
    await using _lifetime = lease
    enqueueCloudReference(http, REFERENCE)
    http.enqueue(ENDPOINTS.pullURL, new Response('{"status":"success"}\n'))
    http.enqueue(ENDPOINTS.chatURL, jsonResponse({ done: true }))
    // When
    await runtime.openChat({ model: REFERENCE.referenceId, messages: [], stream: true }, SIGNAL)
    // Then
    expect(http.requests.map(({ url }) => url)).toEqual([
      ENDPOINTS.tagsURL,
      SELECTED,
      expect.stringContaining("/library/gemma4/blobs/sha256:"),
      ENDPOINTS.pullURL,
      ENDPOINTS.chatURL,
    ])
    const pull = http.requests.find(({ url }) => url === ENDPOINTS.pullURL)
    expect(await new Response(pull?.init?.body).json()).toEqual({
      model: REFERENCE.referenceId,
      stream: true,
    })
  })

  for (const hostedId of ["gemma4", "gemma4:other"]) {
    it(`rejects the selected alias when it now targets ${hostedId}`, async () => {
      // Given
      const { http, lease, runtime } = await fixture()
      await using _lifetime = lease
      enqueueCloudReference(http, { ...REFERENCE, hostedId })
      enqueueCloudReference(http, { ...REFERENCE, referenceId: "gemma4:31b-cloud" })
      // When
      const result = runtime.openChat(
        { model: REFERENCE.referenceId, messages: [], stream: true },
        SIGNAL,
      )
      // Then
      await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
      expect(http.requests.some(({ url }) => url === ALTERNATE || url === ENDPOINTS.pullURL)).toBe(
        false,
      )
    })
  }

  it("rejects a missing selected alias even when another candidate would verify", async () => {
    // Given
    const { http, lease, runtime } = await fixture()
    await using _lifetime = lease
    http.enqueue(SELECTED, jsonResponse({}, 404))
    enqueueCloudReference(http, { ...REFERENCE, referenceId: "gemma4:31b-cloud" })
    // When
    const result = runtime.openChat(
      { model: REFERENCE.referenceId, messages: [], stream: true },
      SIGNAL,
    )
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    expect(http.requests.map(({ url }) => url)).toEqual([ENDPOINTS.tagsURL, SELECTED])
  })

  it("rejects a weight-bearing selected manifest before blob or pull", async () => {
    // Given
    const { http, lease, runtime } = await fixture()
    await using _lifetime = lease
    http.enqueue(
      SELECTED,
      jsonResponse({
        schemaVersion: 2,
        mediaType: "application/vnd.docker.distribution.manifest.v2+json",
        config: { digest: `sha256:${"a".repeat(64)}`, size: 2 },
        layers: [{ size: 1000 }],
      }),
    )
    // When
    const result = runtime.openChat(
      { model: REFERENCE.referenceId, messages: [], stream: true },
      SIGNAL,
    )
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaCatalogError)
    expect(http.requests.map(({ url }) => url)).toEqual([ENDPOINTS.tagsURL, SELECTED])
  })
})
