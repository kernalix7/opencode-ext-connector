import { expect, it, spyOn } from "bun:test"
import { OllamaGenerationError } from "../../../src/providers/ollama/errors"
import {
  cloudManifestUrl,
  enqueueCloudCatalog,
  enqueueCloudReference,
} from "../providers/ollama/cloud-fixtures"
import { jsonResponse } from "../providers/ollama/http-fake"
import { assertNever, fixture, invoke, reference } from "./ollama-sdk-lifecycle-fixture"

for (const mode of ["generate", "stream"] as const) {
  for (const change of [
    "dispose",
    "remove",
    "replace",
    "refresh-same",
    "changed-provenance",
    "keep",
    "caller-abort",
  ] as const) {
    it(`checks first-use SDK ${mode} after ${change} during a pending pull`, async () => {
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
        // When: apply the lifecycle transition after preflight and pull dispatch.
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
          case "changed-provenance":
            enqueueCloudCatalog(f.http.replies, ["one:other"])
            f.http.replies.enqueue(cloudManifestUrl("one:other-cloud"), jsonResponse({}, 404))
            enqueueCloudReference(f.http.replies, {
              hostedId: "one:other",
              referenceId: reference.referenceId,
            })
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
          case "refresh-same":
            expect(outcome).toBeNull()
            break
          case "caller-abort":
            expect(outcome).toMatchObject({ code: "operation-cancelled" })
            break
          case "dispose":
          case "remove":
          case "replace":
          case "changed-provenance":
            expect(outcome).toBeInstanceOf(OllamaGenerationError)
            expect(outcome).toMatchObject({ operation: "model-unavailable" })
            break
          default:
            assertNever(change)
        }
        expect(
          f.http.requests.filter(({ url }) => url === f.bundle.endpoints.chatURL),
        ).toHaveLength(change === "keep" || change === "refresh-same" ? 1 : 0)
        expect(
          f.http.requests.filter(({ url }) => url === f.bundle.endpoints.pullURL),
        ).toHaveLength(1)
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

it("checks each SDK waiter's original authorization when a reintroduced caller joins the same pull", async () => {
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
    enqueueCloudCatalog(f.http.replies, ["two"])
    enqueueCloudReference(f.http.replies, { hostedId: "two", referenceId: "two:cloud" })
    await f.lease.refresh(f.caller.signal)
    f.enqueue()
    await f.lease.refresh(f.caller.signal)
    const joined = Promise.withResolvers<void>()
    f.http.replies.enqueue(f.bundle.endpoints.tagsURL, jsonResponse({ models: [] }))
    const original = f.bundle.catalog.cloudPullAuthorization
    const intercept = spyOn(f.bundle.catalog, "cloudPullAuthorization").mockImplementation((id) => {
      const authorization = original(id)
      joined.resolve()
      return authorization
    })
    try {
      second = invoke(f.model, "stream", f.caller.signal).then(
        () => null,
        (error: unknown) => error,
      )
      await joined.promise
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
