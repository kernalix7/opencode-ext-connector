import { describe, expect, it } from "bun:test"

import { ResourceDisposedError } from "../../../../src/core/errors"
import { createOllamaCatalogState } from "../../../../src/providers/ollama/catalog-state"
import { OllamaGenerationError } from "../../../../src/providers/ollama/errors"
import type { OllamaFetch } from "../../../../src/providers/ollama/http"
import { createOllamaRuntime } from "../../../../src/providers/ollama/runtime"
import { enqueueCloudCatalog, enqueueCloudReference } from "./cloud-fixtures"
import { FakeFetch, jsonResponse } from "./http-fake"

const SIGNAL = new AbortController().signal
const REFERENCE = { hostedId: "one:variant", referenceId: "one:variant-cloud" } as const
const TAGS = "http://localhost:11434/api/tags"
const PULL = "http://localhost:11434/api/pull"

function fixture() {
  const http = new FakeFetch()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let paused = false
  const fetch: OllamaFetch = async (url, init) => {
    const response = await http.fetch(url, init)
    if (paused && url.includes("/blobs/")) {
      started.resolve()
      await release.promise
    }
    return response
  }
  const state = createOllamaCatalogState({ fetch })
  const lease = state.acquire()
  const runtime = createOllamaRuntime({ catalog: state, fetch })
  const enqueue = (): void => {
    enqueueCloudCatalog(http, [REFERENCE.hostedId])
    enqueueCloudReference(http, REFERENCE)
  }
  return {
    http,
    state,
    lease,
    runtime,
    started,
    release,
    enqueue,
    pause: (value = true) => {
      paused = value
    },
  }
}

describe("Ollama catalog lifetime", () => {
  for (const keepOtherLease of [false, true]) {
    it(`cannot publish a disposed lease's awaited refresh with another lease ${keepOtherLease ? "active" : "absent"}`, async () => {
      // Given
      const f = fixture()
      const other = keepOtherLease ? f.state.acquire() : null
      f.enqueue()
      f.pause()
      const refresh = f.lease.refresh(SIGNAL)
      await f.started.promise
      // When
      await f.lease.dispose()
      f.release.resolve()
      // Then
      await expect(refresh).rejects.toBeInstanceOf(ResourceDisposedError)
      expect(f.state.authorizesCloudPull(REFERENCE.referenceId)).toBe(false)
      expect(other?.models() ?? []).toEqual([])
      await other?.dispose()
    })
  }

  for (const revoke of ["dispose", "retire", "replace-lease"] as const) {
    it(`rejects without pull when authorization changes by ${revoke} during metadata verification`, async () => {
      // Given
      const f = fixture()
      await using _lifetime = f.lease
      f.enqueue()
      await f.lease.refresh(SIGNAL)
      f.http.enqueue(TAGS, jsonResponse({ models: [] }))
      enqueueCloudReference(f.http, REFERENCE)
      f.pause()
      const chat = f.runtime.openChat(
        { model: REFERENCE.referenceId, messages: [], stream: true },
        SIGNAL,
      )
      await f.started.promise
      let replacement: ReturnType<typeof f.state.acquire> | null = null
      // When
      switch (revoke) {
        case "dispose":
          await f.lease.dispose()
          break
        case "retire":
          enqueueCloudCatalog(f.http, ["two"])
          enqueueCloudReference(f.http, { hostedId: "two", referenceId: "two:cloud" })
          f.pause(false)
          await f.lease.refresh(SIGNAL)
          break
        case "replace-lease": {
          await f.lease.dispose()
          replacement = f.state.acquire()
          f.enqueue()
          f.pause(false)
          await replacement.refresh(SIGNAL)
          break
        }
      }
      f.release.resolve()
      // Then
      await expect(chat).rejects.toBeInstanceOf(OllamaGenerationError)
      expect(f.http.requests.some(({ url }) => url === PULL)).toBe(false)
      await replacement?.dispose()
    })
  }

  it("cancels all metadata waiters without dispatching pull when verification completes late", async () => {
    // Given
    const f = fixture()
    await using _lifetime = f.lease
    f.enqueue()
    await f.lease.refresh(SIGNAL)
    f.http.enqueue(TAGS, jsonResponse({ models: [] }))
    enqueueCloudReference(f.http, REFERENCE)
    f.pause()
    const abort = new AbortController()
    const chat = f.runtime.openChat(
      { model: REFERENCE.referenceId, messages: [], stream: true },
      abort.signal,
    )
    await f.started.promise
    // When
    abort.abort()
    f.release.resolve()
    // Then
    await expect(chat).rejects.toMatchObject({ code: "operation-cancelled" })
    expect(f.http.requests.some(({ url }) => url === PULL)).toBe(false)
  })

  it("keeps the shared verification alive when only one metadata waiter cancels", async () => {
    // Given
    const f = fixture()
    await using _lifetime = f.lease
    f.enqueue()
    await f.lease.refresh(SIGNAL)
    f.http.enqueue(TAGS, jsonResponse({ models: [] }))
    f.http.enqueue(TAGS, jsonResponse({ models: [] }))
    enqueueCloudReference(f.http, REFERENCE)
    f.http.enqueue(PULL, new Response('{"status":"success"}\n'))
    f.http.enqueue("http://localhost:11434/api/chat", jsonResponse({ done: true }))
    f.pause()
    const abort = new AbortController()
    const request = { model: REFERENCE.referenceId, messages: [], stream: true } as const
    const first = f.runtime.openChat(request, abort.signal)
    const second = f.runtime.openChat(request, SIGNAL)
    await f.started.promise
    // When
    abort.abort()
    f.release.resolve()
    // Then
    await expect(first).rejects.toMatchObject({ code: "operation-cancelled" })
    await expect(second).resolves.toBeInstanceOf(Response)
    expect(f.http.requests.filter(({ url }) => url.includes("/manifests/"))).toHaveLength(2)
    expect(f.http.requests.filter(({ url }) => url === PULL)).toHaveLength(1)
  })
})
