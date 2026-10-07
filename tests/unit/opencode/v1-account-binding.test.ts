import { afterEach, describe, expect, it, spyOn } from "bun:test"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { NoSuchModelError } from "@ai-sdk/provider"
import type { Hooks } from "@opencode-ai/plugin"

import { languageForV1Provider } from "../../../src/opencode/v1-language"
import { buildV1Hooks } from "../../../src/opencode/v1-module"
import { createClaude } from "../../../src/sdk/claude"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { apiTestEntry } from "./api-test-entry"

type HostConfig = Parameters<NonNullable<Hooks["config"]>>[0]
const prompt: LanguageModelV3CallOptions["prompt"] = [
  { role: "user", content: [{ type: "text", text: "fixture" }] },
]
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const catalog = { data: [{ id: "shared-model" }], has_more: false, last_id: "shared-model" }
const message = {
  id: "msg_fixture",
  type: "message",
  model: "shared-model",
  role: "assistant",
  content: [{ type: "text", text: "bound-ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
}

async function fixture() {
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({ status: 200, headers: {}, body: encode(catalog) })
  let key: string | null = "fixture-account-a"
  const hooks = await buildV1Hooks({
    clock: new FakeClock(),
    transport,
    env: {},
    catalogReloadMs: 0,
    authStore: {
      matchAuth: async (provider) =>
        provider === "claude" && key !== null ? { kind: "api-key", key } : null,
    },
    providers: [apiTestEntry()],
    npmSpecifiers: { claude: "file:///fixture/claude.js" },
  })
  const config: HostConfig = {}
  await hooks.config?.(config)
  const options = config.provider?.["claude"]?.options ?? {}
  return {
    hooks,
    transport,
    config,
    options,
    setKey: (value: string | null) => {
      key = value
    },
  }
}

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore()
})

describe("V1 generation-bound SDK models", () => {
  it("dispatches with the captured account and projects no credential", async () => {
    // Given
    const state = await fixture()
    state.transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      body: encode(message),
    })
    const model = createClaude(state.options).languageModel("shared-model")
    // When
    const result = await model.doGenerate({ prompt, maxOutputTokens: 8 })
    // Then
    expect(result.content).toContainEqual({ type: "text", text: "bound-ok" })
    expect(state.transport.requests.at(-1)?.headers["x-api-key"]).toBe("fixture-account-a")
    expect(JSON.stringify(state.config)).not.toContain("fixture-account-a")
    await state.hooks.dispose?.()
  })

  it("rejects a captured model rather than adopting a different account", async () => {
    // Given
    const state = await fixture()
    const model = createClaude(state.options).languageModel("shared-model")
    state.setKey("fixture-account-b")
    // When
    const result = model.doGenerate({ prompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(NoSuchModelError)
    expect(state.transport.requests).toHaveLength(1)
    expect(state.config.provider?.["claude"]).toBeUndefined()
    await state.hooks.dispose?.()
  })

  it("rejects streaming after the selected account disappears", async () => {
    // Given
    const state = await fixture()
    const model = createClaude(state.options).languageModel("shared-model")
    state.setKey(null)
    // When
    const result = model.doStream({ prompt })
    // Then
    await expect(result).rejects.toBeInstanceOf(NoSuchModelError)
    expect(state.transport.requests).toHaveLength(1)
    await state.hooks.dispose?.()
  })

  it("revokes construction and captured views when their owner is disposed", async () => {
    // Given
    const state = await fixture()
    const model = createClaude(state.options).languageModel("shared-model")
    await state.hooks.dispose?.()
    // When
    const result = model.doGenerate({ prompt })
    // Then
    await expect(result).rejects.toThrow()
    expect(() => createClaude(state.options).languageModel("shared-model")).toThrow(
      NoSuchModelError,
    )
    expect(state.transport.requests).toHaveLength(1)
  })

  it("does not escape an unknown binding through an explicit API key", () => {
    // Given
    const options = {
      connectorV1: { owner: crypto.randomUUID(), generation: crypto.randomUUID() },
      apiKey: "fixture-fallback",
    }
    // When / Then
    expect(() => languageForV1Provider("claude", "shared-model", options)).toThrow(NoSuchModelError)
  })

  it("honors an explicit standalone API key without consulting the auth store", async () => {
    // Given
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(message), { headers: { "content-type": "application/json" } }),
    )
    const model = createClaude({ apiKey: "fixture-standalone" }).languageModel("shared-model")
    // When
    const result = await model.doGenerate({ prompt, maxOutputTokens: 8 })
    // Then
    expect(result.content).toContainEqual({ type: "text", text: "bound-ok" })
    const init = fetch.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get("x-api-key")).toBe("fixture-standalone")
  })
})
