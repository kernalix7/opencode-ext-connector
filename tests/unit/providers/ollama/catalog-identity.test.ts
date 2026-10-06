import { expect, it } from "bun:test"

import { createOllamaCatalogState } from "../../../../src/providers/ollama/catalog-state"
import { createOllamaRuntime } from "../../../../src/providers/ollama/runtime"
import { cloudManifestUrl, enqueueCloudCatalog, enqueueCloudReference } from "./cloud-fixtures"
import { jsonResponse } from "./http-fake"
import { LifecycleFetch } from "./lifecycle-fetch"

const original = { hostedId: "one", referenceId: "one:cloud" } as const
const changed = { hostedId: "one:other", referenceId: "one:cloud" } as const
const removed = { hostedId: "two", referenceId: "two:cloud" } as const
const tags = "http://localhost:11434/api/tags"
const pull = "http://localhost:11434/api/pull"
const chat = "http://localhost:11434/api/chat"

for (const transition of [
  "identical",
  "changed",
  "remove-return",
  "change-return",
  "release-reacquire",
] as const) {
  it(`checks original authorization after ${transition} during a dispatched pull`, async () => {
    // Given: real state/runtime with the first pull held at the HTTP boundary.
    const http = new LifecycleFetch()
    const controller = new AbortController()
    const state = createOllamaCatalogState({ fetch: http.fetch })
    const lease = state.acquire()
    let replacement: ReturnType<typeof state.acquire> | null = null
    let outcome: Promise<unknown> | undefined
    const refresh = async (
      reference: typeof original | typeof changed | typeof removed,
    ): Promise<void> => {
      enqueueCloudCatalog(http.replies, [reference.hostedId])
      if (reference.hostedId === changed.hostedId) {
        http.replies.enqueue(cloudManifestUrl("one:other-cloud"), jsonResponse({}, 404))
      }
      enqueueCloudReference(http.replies, reference)
      await (replacement ?? lease).refresh(controller.signal)
    }
    try {
      await refresh(original)
      http.replies.enqueue(tags, jsonResponse({ models: [] }))
      enqueueCloudReference(http.replies, original)
      http.replies.enqueue(pull, new Response('{"status":"success"}\n'))
      http.replies.enqueue(chat, jsonResponse({ done: true }))
      http.block(pull)
      const runtime = createOllamaRuntime({ catalog: state, fetch: http.fetch })
      outcome = runtime
        .openChat({ model: original.referenceId, messages: [], stream: true }, controller.signal)
        .then(
          () => null,
          (error: unknown) => error,
        )
      await http.started(pull)
      // When: publish the complete transition before allowing pull completion.
      switch (transition) {
        case "identical":
          await refresh(original)
          break
        case "changed":
          await refresh(changed)
          break
        case "remove-return":
          await refresh(removed)
          await refresh(original)
          break
        case "change-return":
          await refresh(changed)
          await refresh(original)
          break
        case "release-reacquire":
          await lease.dispose()
          replacement = state.acquire()
          await refresh(original)
          break
        default:
          throw new TypeError(transition satisfies never)
      }
      http.release(pull)
      // Then: only uninterrupted semantic identity permits the original caller's chat.
      const result = await outcome
      switch (transition) {
        case "identical":
          expect(result).toBeNull()
          break
        case "changed":
        case "remove-return":
        case "change-return":
        case "release-reacquire":
          expect(result).toMatchObject({ operation: "model-unavailable" })
          break
        default:
          throw new TypeError(transition satisfies never)
      }
      expect(http.requests.filter(({ url }) => url === pull)).toHaveLength(1)
      expect(http.requests.filter(({ url }) => url === chat)).toHaveLength(
        transition === "identical" ? 1 : 0,
      )
    } finally {
      controller.abort()
      http.release(pull)
      await outcome
      await replacement?.dispose()
      await lease.dispose()
    }
  })
}
