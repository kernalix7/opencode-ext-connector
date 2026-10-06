import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { type LanguageModelV3CallOptions, NoSuchModelError } from "@ai-sdk/provider"
import type { Hooks } from "@opencode-ai/plugin"

import type { HttpResponse, HttpTransport } from "../../../src/core/http"
import { resolveV1ModelView } from "../../../src/opencode/v1-binding"
import { createClaude } from "../../../src/sdk/claude"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { getTestPackageDist } from "../../support/test-package"
import { cleanups, fixture } from "./v1-generation-edge-fixtures"

type HostConfig = Parameters<NonNullable<Hooks["config"]>>[0]
const call: LanguageModelV3CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }],
}
const response = (value: unknown): HttpResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: new TextEncoder().encode(JSON.stringify(value)),
})
const catalog = (id = "shared-model"): HttpResponse =>
  response({ data: [{ id }], has_more: false, last_id: id })
const message = response({
  id: "msg_edge",
  type: "message",
  model: "shared-model",
  role: "assistant",
  content: [{ type: "text", text: "edge-ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
})
afterEach(async () => {
  spyOn(globalThis, "fetch").mockRestore()
  await Promise.all(cleanups.splice(0).map((dispose) => dispose()))
})

describe("V1 generation edges", () => {
  for (const change of ["dispose", "replace"] as const) {
    it(`keeps the other owner's key and transport when one owner ${change}s`, async () => {
      // Given
      const firstTransport = new FakeHttpTransport()
      const secondTransport = new FakeHttpTransport()
      const first = fixture("fixture-owner-a", firstTransport)
      const second = fixture("fixture-owner-b", secondTransport)
      firstTransport.enqueueResponse(catalog())
      secondTransport.enqueueResponse(catalog())
      await Promise.all([first.owner.refresh(), second.owner.refresh()])
      const retained = createClaude(second.options()).languageModel("shared-model")
      switch (change) {
        case "dispose":
          await first.owner.dispose()
          break
        case "replace":
          first.setKey("fixture-owner-c")
          firstTransport.enqueueResponse(catalog("replacement-model"))
          await first.owner.refresh()
          break
        default:
          change satisfies never
      }
      secondTransport.enqueueResponse(message)
      const firstRequests = firstTransport.requests.length
      // When
      const result = await retained.doGenerate(call)
      // Then
      expect(result.content).toContainEqual({ type: "text", text: "edge-ok" })
      expect(secondTransport.requests.at(-1)?.headers["x-api-key"]).toBe("fixture-owner-b")
      expect(firstTransport.requests).toHaveLength(firstRequests)
      expect(JSON.stringify(second.config)).not.toContain("fixture-owner-b")
    })
  }

  it("excludes a late old catalog after a request observes the new key", async () => {
    // Given
    const wire = new FakeHttpTransport()
    const started = Promise.withResolvers<void>()
    const late = Promise.withResolvers<HttpResponse>()
    let deferred = false
    // This fake deliberately completes an old request despite cancellation.
    const transport: HttpTransport = {
      request: async (request, signal) => {
        if (deferred) {
          started.resolve()
          return late.promise
        }
        return wire.request(request, signal)
      },
    }
    const state = fixture("fixture-late-a", transport)
    wire.enqueueResponse(catalog())
    await state.owner.refresh()
    const view = resolveV1ModelView(state.options()["connectorV1"], "claude", "shared-model")
    deferred = true
    const refreshing = state.owner.refresh()
    await started.promise
    state.setKey("fixture-late-b")
    await expect(view.readApiKey(new AbortController().signal)).rejects.toBeInstanceOf(
      NoSuchModelError,
    )
    // When
    late.resolve(catalog("old-only-model"))
    await refreshing
    const afterLate = state.config.provider?.["claude"]
    deferred = false
    wire.enqueueResponse(catalog("new-only-model"))
    await state.owner.refresh()
    // Then
    expect(afterLate).toBeUndefined()
    expect(Object.keys(state.config.provider?.["claude"]?.models ?? {})).toEqual(["new-only-model"])
    expect(wire.requests.at(-1)?.headers["x-api-key"]).toBe("fixture-late-b")
    expect(() => createClaude(state.options()).languageModel("old-only-model")).toThrow(
      NoSuchModelError,
    )
    expect(JSON.stringify(state.config)).not.toContain("fixture-late-a")
    expect(JSON.stringify(state.config)).not.toContain("fixture-late-b")
  })

  it("re-lists a new key before the old generation's backoff expires", async () => {
    // Given
    const wire = new FakeHttpTransport()
    const state = fixture("fixture-backoff-a", wire)
    wire.enqueueResponse({ status: 503, headers: {}, body: new Uint8Array() })
    await state.owner.refresh()
    await state.owner.refresh()
    expect(wire.requests).toHaveLength(1)
    state.setKey("fixture-backoff-b")
    wire.enqueueResponse(catalog())
    // When
    await state.owner.refresh()
    wire.enqueueResponse(message)
    const result = await createClaude(state.options())
      .languageModel("shared-model")
      .doGenerate(call)
    // Then
    expect(state.clock.nowMs()).toBe(0)
    expect(wire.requests).toHaveLength(3)
    expect(wire.requests.at(-2)?.headers["x-api-key"]).toBe("fixture-backoff-b")
    expect(Object.keys(state.config.provider?.["claude"]?.models ?? {})).toEqual(["shared-model"])
    expect(result.content).toContainEqual({ type: "text", text: "edge-ok" })
    expect(wire.requests.at(-1)?.headers["x-api-key"]).toBe("fixture-backoff-b")
  })

  it("shares the emitted hooks registry with the actual emitted SDK", async () => {
    // Given
    const dist = getTestPackageDist()
    const builtHooks: typeof import("../../../src/opencode/v1-module") = await import(
      pathToFileURL(join(dist, "opencode/v1-module.js")).href
    )
    const builtSdk: typeof import("../../../src/sdk/claude") = await import(
      pathToFileURL(join(dist, "sdk/claude.js")).href
    )
    const builtProviders: typeof import("../../../src/opencode/providers") = await import(
      pathToFileURL(join(dist, "opencode/providers.js")).href
    )
    const wire = new FakeHttpTransport()
    wire.enqueueResponse(catalog())
    const hooks = await builtHooks.buildV1Hooks({
      clock: new FakeClock(),
      transport: wire,
      env: {},
      catalogReloadMs: 0,
      authStore: { matchAuth: async () => ({ kind: "api-key", key: "fixture-built" }) },
      providers: builtProviders.createProviderRegistry().filter((entry) => entry.id === "claude"),
      npmSpecifiers: { claude: pathToFileURL(join(dist, "sdk/claude.js")).href },
    })
    cleanups.push(async () => {
      await hooks.dispose?.()
    })
    const config: HostConfig = {}
    await hooks.config?.(config)
    wire.enqueueResponse(message)
    // When
    const result = await builtSdk
      .createClaude(config.provider?.["claude"]?.options ?? {})
      .languageModel("shared-model")
      .doGenerate(call)
    // Then
    expect(result.content).toContainEqual({ type: "text", text: "edge-ok" })
    expect(wire.requests.at(-1)?.headers["x-api-key"]).toBe("fixture-built")
    expect(JSON.stringify(config)).not.toContain("fixture-built")
  })

  for (const binding of [
    null,
    {},
    { owner: crypto.randomUUID(), generation: crypto.randomUUID() },
  ]) {
    it("rejects malformed or unknown bound input despite an explicit standalone key", () => {
      // Given
      const options = { connectorV1: binding, apiKey: "fixture-explicit" }
      // When
      let failure: Error | undefined
      try {
        createClaude(options).languageModel("shared-model")
      } catch (error: unknown) {
        if (!(error instanceof Error)) throw error
        failure = error
      }
      // Then
      expect(failure).toBeInstanceOf(NoSuchModelError)
      expect(JSON.stringify(failure)).not.toContain("fixture-explicit")
      expect(failure?.message).not.toContain("fixture-explicit")
    })
  }

  it("generates independently with an explicit standalone key", async () => {
    // Given
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(message.body, {
        headers: { "content-type": "application/json" },
      }),
    )
    const model = createClaude({ apiKey: "fixture-explicit" }).languageModel("shared-model")
    // When
    const result = await model.doGenerate(call)
    // Then
    expect(result.content).toContainEqual({ type: "text", text: "edge-ok" })
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-api-key")).toBe("fixture-explicit")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
