import { describe, expect, it } from "bun:test"

import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError } from "../../../src/core/errors"
import { parseProviderId } from "../../../src/core/ids"
import { createConnectorLogger } from "../../../src/core/logger"
import { setupV2Connector } from "../../../src/opencode/v2-setup"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { MemoryLogSink } from "../../support/log-sink"
import { createV2Host, credentialConnection } from "./v2-host"

const prompt: LanguageModelV3CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
}

function enqueueGeneration(transport: FakeHttpTransport): void {
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode(
      JSON.stringify({
        data: [{ id: "qwen-test", supported_endpoints: ["/provider/v1/chat/completions"] }],
      }),
    ),
  })
  transport.enqueueResponse({
    status: 200,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(
      JSON.stringify({
        id: "chat_fixture",
        created: 1700000000,
        model: "qwen-test",
        choices: [
          { index: 0, message: { role: "assistant", content: "fresh" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    ),
  })
}

async function connectedScope() {
  const host = createV2Host({
    pluginOptions: { providers: ["command-code"], catalogReloadMs: 0 },
  })
  host.setConnection("command-code", credentialConnection("command-code", "key"))
  host.setKey("command-code", "scope-test-key")
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode(
      JSON.stringify({
        data: [{ id: "qwen-test", supported_endpoints: ["/provider/v1/chat/completions"] }],
      }),
    ),
  })
  const cleanup = await setupV2Connector(host, {
    env: {},
    clock: new FakeClock(),
    createTransport: () => transport,
    createLogger: (clock) => createConnectorLogger(clock, new MemoryLogSink()),
  })
  return { host, transport, cleanup }
}

function materializedModel(host: Awaited<ReturnType<typeof connectedScope>>["host"]) {
  const record = host.providers()[0]
  const model = record?.models.get("qwen-test")
  if (record === undefined || model === undefined || model.package === undefined) {
    throw new Error("missing published model")
  }
  // CLI 2.0.20 merges provider defaults before computing the native AISDK cache keys.
  const settings = { ...record.provider.settings, ...model.settings }
  return {
    input: {
      providerID: model.providerID,
      modelID: model.modelID,
      modelPackage: model.package,
    },
    settings,
    languageKey: JSON.stringify({
      providerID: model.providerID,
      canonical: model.canonical,
      id: model.id,
      modelID: model.modelID,
      package: model.package,
      settings,
      headers: model.headers,
      body: model.body,
      limit: model.limit,
    }),
    sdkKey: JSON.stringify({ providerID: model.providerID, package: model.package, settings }),
  }
}

function languageFor(host: Awaited<ReturnType<typeof connectedScope>>["host"]): LanguageModelV3 {
  const { input } = materializedModel(host)
  const hook = host.hooks.find(
    (item) => item.name === "language" && item.providerID === input.providerID,
  )
  const language = hook?.invoke(input).language
  if (language === undefined) throw new Error("missing scoped language")
  return language
}

describe("V2 scoped language lifetime", () => {
  it.each([
    { operation: "generate", invoke: (model: LanguageModelV3) => model.doGenerate(prompt) },
    { operation: "stream", invoke: (model: LanguageModelV3) => model.doStream(prompt) },
  ])(
    "rejects cached $operation after cleanup while the connection remains valid",
    async ({ operation, invoke }) => {
      // Given
      const scope = await connectedScope()
      try {
        const model = languageFor(scope.host)
        enqueueGeneration(scope.transport)
        const requestsBefore = scope.transport.requests.length
        await scope.cleanup()

        // When
        const result = await invoke(model).then(
          () => undefined,
          (error: unknown) => error,
        )

        // Then
        expect(result).toBeInstanceOf(AdapterError)
        if (!(result instanceof AdapterError)) throw result
        expect(result.providerId).toBe(parseProviderId("command-code"))
        expect(result.operation).toBe(operation)
        expect(result.retryable).toBe(false)
        expect(scope.transport.requests).toHaveLength(requestsBefore)
      } finally {
        await scope.cleanup()
      }
    },
  )

  it("misses retained native caches when an identical setup creates a fresh scope", async () => {
    // Given
    const first = await connectedScope()
    try {
      const previous = materializedModel(first.host)
      const cached = languageFor(first.host)
      const languageCache = new Map([[previous.languageKey, cached]])
      const sdkCache = new Map([[previous.sdkKey, { language: cached }]])
      await first.cleanup()
      const second = await connectedScope()
      try {
        const current = materializedModel(second.host)
        enqueueGeneration(second.transport)
        const previousRequests = first.transport.requests.length

        // When
        const selected = languageCache.get(current.languageKey) ?? languageFor(second.host)
        const generated = await selected.doGenerate(prompt)
        await second.host.provider.reload()

        // Then
        expect(current.input).toEqual(previous.input)
        expect(current.settings).not.toEqual(previous.settings)
        expect(languageCache.has(current.languageKey)).toBe(false)
        expect(sdkCache.has(current.sdkKey)).toBe(false)
        expect(selected).not.toBe(cached)
        expect(generated.content).toEqual([{ type: "text", text: "fresh" }])
        expect(second.transport.requests.at(-1)?.url).toEndWith("/provider/v1/chat/completions")
        expect(first.transport.requests).toHaveLength(previousRequests)
        expect(materializedModel(second.host).languageKey).toBe(current.languageKey)
        expect(materializedModel(second.host).sdkKey).toBe(current.sdkKey)
      } finally {
        await second.cleanup()
      }
    } finally {
      await first.cleanup()
    }
  })
})
