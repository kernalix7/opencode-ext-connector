import { describe, expect, it } from "bun:test"

import { OllamaCatalogError } from "../../../../src/providers/ollama"
import { type OllamaFetch, requestOllamaCatalog } from "../../../../src/providers/ollama/http"

describe("requestOllamaCatalog", () => {
  it("maps a foreign-realm-like fetch rejection to a transport error", async () => {
    // Given
    const rejection = new (class ForeignFetchTypeError extends Error {
      public override readonly name = "TypeError"
      public readonly code = "ConnectionRefused"
    })("Unable to connect")
    expect(rejection).not.toBeInstanceOf(globalThis.TypeError)
    expect(rejection).not.toBeInstanceOf(DOMException)
    const fetch: OllamaFetch = () => Promise.reject(rejection)

    // When
    const promise = requestOllamaCatalog({
      url: "http://localhost:11434/api/tags",
      accept: "application/json",
      operation: "local-tags",
      fetch,
      signal: new AbortController().signal,
    })

    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    await expect(promise).rejects.toMatchObject({
      operation: "local-tags",
      kind: "transport-error",
    })
  })
})
