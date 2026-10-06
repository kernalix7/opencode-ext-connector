import { expect, it, spyOn } from "bun:test"
import { randomUUID } from "node:crypto"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { getProductionOllamaBundle } from "../../../src/opencode/ollama-production"
import { OllamaGenerationError } from "../../../src/providers/ollama/errors"
import { createOllama } from "../../../src/sdk/ollama"
import { enqueueCloudCatalog, enqueueCloudReference } from "../providers/ollama/cloud-fixtures"
import { jsonResponse } from "../providers/ollama/http-fake"
import { LifecycleFetch } from "../providers/ollama/lifecycle-fetch"

const reference = { hostedId: "one", referenceId: "one:cloud" } as const
const prompt: LanguageModelV3CallOptions["prompt"] = [
  { role: "user", content: [{ type: "text", text: "synthetic lifecycle fixture" }] },
]

function assertNever(_value: never): never {
  throw new TypeError("Unexpected lifecycle fixture variant")
}

function fixture() {
  const http = new LifecycleFetch()
  const base = `http://sdk-lifecycle.test/${randomUUID()}`
  const bundle = getProductionOllamaBundle(base)
  const replacement: typeof fetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      http.fetch(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        init,
      ),
    { preconnect: () => undefined },
  )
  const intercept = spyOn(globalThis, "fetch").mockImplementation(replacement)
  const caller = new AbortController()
  const lease = bundle.catalog.acquire()
  const enqueue = (): void => {
    enqueueCloudCatalog(http.replies, [reference.hostedId])
    enqueueCloudReference(http.replies, reference)
  }
  const prepare = (): void => {
    http.replies.enqueue(bundle.endpoints.tagsURL, jsonResponse({ models: [] }))
    enqueueCloudReference(http.replies, reference)
    http.replies.enqueue(bundle.endpoints.pullURL, new Response('{"status":"success"}\n'))
    http.replies.enqueue(
      bundle.endpoints.chatURL,
      new Response('{"message":{"content":"ok"},"done":true}\n'),
    )
    http.block(bundle.endpoints.pullURL)
  }
  const cleanup = async (): Promise<void> => {
    caller.abort()
    http.release(bundle.endpoints.pullURL)
    await lease.dispose()
    intercept.mockRestore()
  }
  return {
    http,
    bundle,
    caller,
    lease,
    enqueue,
    prepare,
    cleanup,
    model: createOllama({ ollamaBaseURL: base }).languageModel(reference.referenceId),
  }
}

async function invoke(
  model: LanguageModelV3,
  mode: "generate" | "stream",
  signal: AbortSignal,
): Promise<void> {
  switch (mode) {
    case "generate":
      await model.doGenerate({ prompt, abortSignal: signal })
      return
    case "stream": {
      const result = await model.doStream({ prompt, abortSignal: signal })
      for await (const _chunk of result.stream) {
        /* Drain the real SDK stream. */
      }
      return
    }
    default:
      return assertNever(mode)
  }
}

for (const mode of ["generate", "stream"] as const) {
  for (const change of [
    "dispose",
    "remove",
    "replace",
    "refresh-same",
    "keep",
    "caller-abort",
  ] as const) {
    it(`blocks revoked first-use SDK ${mode} after ${change} during a pending pull`, async () => {
      // Given: real SDK and production bundle, only the HTTP boundary is fake.
      const f = fixture()
      let replacementLease: ReturnType<typeof f.bundle.catalog.acquire> | null = null
      let observed: Promise<unknown> | undefined
      try {
        f.enqueue()
        await f.lease.refresh(f.caller.signal)
        f.prepare()
        observed = invoke(f.model, mode, f.caller.signal).then(
          () => null,
          (error: unknown) => error,
        )
        await f.http.started(f.bundle.endpoints.pullURL)
        // When: revoke after exact preflight and pull dispatch, before completion.
        switch (change) {
          case "dispose":
            await f.lease.dispose()
            break
          case "remove":
            enqueueCloudCatalog(f.http.replies, ["two"])
            enqueueCloudReference(f.http.replies, { hostedId: "two", referenceId: "two:cloud" })
            await f.lease.refresh(f.caller.signal)
            break
          case "replace":
            await f.lease.dispose()
            replacementLease = f.bundle.catalog.acquire()
            f.enqueue()
            await replacementLease.refresh(f.caller.signal)
            break
          case "refresh-same":
            f.enqueue()
            await f.lease.refresh(f.caller.signal)
            break
          case "keep":
            break
          case "caller-abort":
            f.caller.abort()
            break
          default:
            assertNever(change)
        }
        f.http.release(f.bundle.endpoints.pullURL)
        const outcome = await observed
        // Then
        switch (change) {
          case "keep":
            expect(outcome).toBeNull()
            break
          case "caller-abort":
            expect(outcome).toMatchObject({ code: "operation-cancelled" })
            break
          case "dispose":
          case "remove":
          case "replace":
          case "refresh-same":
            expect(outcome).toBeInstanceOf(OllamaGenerationError)
            expect(outcome).toMatchObject({ operation: "model-unavailable" })
            break
          default:
            assertNever(change)
        }
        expect(
          f.http.requests.filter(({ url }) => url === f.bundle.endpoints.chatURL),
        ).toHaveLength(change === "keep" ? 1 : 0)
      } finally {
        f.caller.abort()
        f.http.release(f.bundle.endpoints.pullURL)
        await observed
        await replacementLease?.dispose()
        await f.cleanup()
      }
    })
  }

  it(`allows SDK ${mode} for an already installed model without a lease`, async () => {
    // Given
    const f = fixture()
    try {
      await f.lease.dispose()
      f.http.replies.enqueue(
        f.bundle.endpoints.tagsURL,
        jsonResponse({ models: [{ name: reference.referenceId }] }),
      )
      f.http.replies.enqueue(
        f.bundle.endpoints.chatURL,
        new Response('{"message":{"content":"ok"},"done":true}\n'),
      )
      // When
      await invoke(f.model, mode, f.caller.signal)
      // Then
      expect(f.http.requests.map(({ url }) => url)).toEqual([
        f.bundle.endpoints.tagsURL,
        f.bundle.endpoints.chatURL,
      ])
    } finally {
      await f.cleanup()
    }
  })
}

it("checks each SDK waiter's original authorization when a refreshed caller joins the same pull", async () => {
  // Given
  const f = fixture()
  let first: Promise<unknown> | undefined
  let second: Promise<unknown> | undefined
  try {
    f.enqueue()
    await f.lease.refresh(f.caller.signal)
    f.prepare()
    first = invoke(f.model, "generate", f.caller.signal).then(
      () => null,
      (error: unknown) => error,
    )
    await f.http.started(f.bundle.endpoints.pullURL)
    f.enqueue()
    await f.lease.refresh(f.caller.signal)
    const tagsReturned = Promise.withResolvers<void>()
    f.http.replies.enqueue(f.bundle.endpoints.tagsURL, jsonResponse({ models: [] }))
    const original = f.http.fetch
    const joiningFetch: typeof fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const response = await original(url, init)
        if (url === f.bundle.endpoints.tagsURL) tagsReturned.resolve()
        return response
      },
      { preconnect: () => undefined },
    )
    const intercept = spyOn(globalThis, "fetch").mockImplementation(joiningFetch)
    try {
      second = invoke(f.model, "stream", f.caller.signal).then(
        () => null,
        (error: unknown) => error,
      )
      await tagsReturned.promise
      // When: both callers complete the same flight with different authorization identities.
      f.http.release(f.bundle.endpoints.pullURL)
      // Then
      expect(await first).toMatchObject({ operation: "model-unavailable" })
      expect(await second).toBeNull()
      expect(f.http.requests.filter(({ url }) => url === f.bundle.endpoints.pullURL)).toHaveLength(
        1,
      )
      expect(f.http.requests.filter(({ url }) => url === f.bundle.endpoints.chatURL)).toHaveLength(
        1,
      )
    } finally {
      intercept.mockRestore()
    }
  } finally {
    f.caller.abort()
    f.http.release(f.bundle.endpoints.pullURL)
    await Promise.all([first, second])
    await f.cleanup()
  }
})
