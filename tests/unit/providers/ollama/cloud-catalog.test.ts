import { describe, expect, it } from "bun:test"

import {
  createOllamaCatalogState,
  discoverOllamaCloudModels,
  OllamaCatalogError,
} from "../../../../src/providers/ollama"
import { FakeFetch, htmlResponse } from "./http-fake"

const SEARCH_URL = "https://ollama.com/search?c=cloud"
const libraryUrl = (family: string): string => `https://ollama.com/library/${family}`

describe("discoverOllamaCloudModels", () => {
  it("discovers exact cloud tags from validated official family links without trusting text", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(
      SEARCH_URL,
      htmlResponse(
        '<a href="/library/glm-5.3-flash">wrong</a><a href="https://evil.test/library/x">x</a>',
      ),
    )
    http.enqueue(
      libraryUrl("glm-5.3-flash"),
      htmlResponse(
        '<a href="/library/glm-5.3-flash:cloud">not cloud</a><a href="/library/glm-5.3-flash:preview">cloud</a><a href="/library/other:cloud">cloud</a>',
      ),
    )
    // When
    const models = await discoverOllamaCloudModels(http.fetch, new AbortController().signal)
    // Then
    expect(models.map(({ id }) => String(id))).toEqual(["glm-5.3-flash:cloud"])
  })

  it("includes tags ending in -cloud and deduplicates exact IDs", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/gpt-oss">gpt</a>'))
    http.enqueue(
      libraryUrl("gpt-oss"),
      htmlResponse(
        '<a href="/library/gpt-oss:120b-cloud">a</a><a href="/library/gpt-oss:120b-cloud">b</a>',
      ),
    )
    // When
    const models = await discoverOllamaCloudModels(http.fetch, new AbortController().signal)
    // Then
    expect(models.map(({ id }) => String(id))).toEqual(["gpt-oss:120b-cloud"])
  })

  it("bounds concurrent family fetches", async () => {
    // Given
    const http = new FakeFetch()
    const families = ["one", "two", "three", "four"]
    http.enqueue(
      SEARCH_URL,
      htmlResponse(families.map((family) => `<a href="/library/${family}">${family}</a>`).join("")),
    )
    for (const family of families) {
      const url = libraryUrl(family)
      http.enqueue(url, htmlResponse(`<a href="/library/${family}:cloud">cloud</a>`))
      http.block(url)
    }
    const promise = discoverOllamaCloudModels(http.fetch, new AbortController().signal, 2)
    await Promise.resolve()
    await Promise.resolve()
    // When
    for (const family of families) http.release(libraryUrl(family))
    const models = await promise
    // Then
    expect(models).toHaveLength(4)
    expect(http.maximumActive).toBe(2)
  })

  it("rejects the complete refresh when any family is empty", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(
      SEARCH_URL,
      htmlResponse('<a href="/library/one">one</a><a href="/library/two">two</a>'),
    )
    http.enqueue(libraryUrl("one"), htmlResponse('<a href="/library/one:cloud">cloud</a>'))
    http.enqueue(libraryUrl("two"), htmlResponse("<p>none</p>"))
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
    http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/one">one</a>'))
    http.enqueue(libraryUrl("one"), htmlResponse('<a href="/library/one:cloud">cloud</a>'))
    http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/two">two</a>'))
    http.enqueue(libraryUrl("two"), htmlResponse('<a href="/library/two:cloud">cloud</a>'))
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
    http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/one">one</a>'))
    http.enqueue(libraryUrl("one"), htmlResponse('<a href="/library/one:cloud">cloud</a>'))
    http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/two">two</a>'))
    http.enqueue(libraryUrl("two"), htmlResponse("<p>empty</p>"))
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
    http.enqueue(SEARCH_URL, htmlResponse('<a href="/library/one">one</a>'))
    http.enqueue(libraryUrl("one"), htmlResponse('<a href="/library/one:cloud">cloud</a>'))
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
