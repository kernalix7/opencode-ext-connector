import { describe, expect, it } from "bun:test"

import { listLocalOllamaModels, OllamaCatalogError } from "../../../../src/providers/ollama"
import { FakeFetch, jsonResponse } from "./http-fake"

const LOCAL_TAGS_URL = "http://localhost:11434/api/tags"

describe("listLocalOllamaModels", () => {
  it("preserves exact currently pulled model IDs", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(
      LOCAL_TAGS_URL,
      jsonResponse({ models: [{ name: "qwen3:8b", size: 42 }, { name: "Case/Exact:Tag" }] }),
    )
    // When
    const models = await listLocalOllamaModels(http.fetch, new AbortController().signal)
    // Then
    expect(models.map(({ id }) => String(id))).toEqual(["qwen3:8b", "Case/Exact:Tag"])
    expect(http.requests).toEqual([
      {
        url: LOCAL_TAGS_URL,
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

  it("accepts a schema-valid empty local catalog", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(LOCAL_TAGS_URL, jsonResponse({ models: [] }))
    // When
    const models = await listLocalOllamaModels(http.fetch, new AbortController().signal)
    // Then
    expect(models).toEqual([])
  })

  it("prefers model and falls back to name for daemon model IDs", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(
      LOCAL_TAGS_URL,
      jsonResponse({
        models: [
          { model: "canonical:latest", name: "canonical:latest" },
          { name: "legacy:latest" },
        ],
      }),
    )
    // When
    const models = await listLocalOllamaModels(http.fetch, new AbortController().signal)
    // Then
    expect(models.map(({ id }) => String(id))).toEqual(["canonical:latest", "legacy:latest"])
  })

  it("rejects conflicting nonempty model and name IDs", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(
      LOCAL_TAGS_URL,
      jsonResponse({ models: [{ model: "canonical:latest", name: "different:latest" }] }),
    )
    // When
    const promise = listLocalOllamaModels(http.fetch, new AbortController().signal)
    // Then
    await expect(promise).rejects.toMatchObject({
      name: "OllamaCatalogError",
      operation: "local-tags",
      kind: "invalid-data",
    })
  })

  it("rejects an oversized response with a sanitized typed error", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(LOCAL_TAGS_URL, jsonResponse({ models: [{ name: "x".repeat(300_000) }] }))
    // When
    const promise = listLocalOllamaModels(http.fetch, new AbortController().signal)
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    await expect(promise).rejects.toMatchObject({ operation: "local-tags", kind: "invalid-data" })
  })
})
