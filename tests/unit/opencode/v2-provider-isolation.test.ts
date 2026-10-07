import { expect, it } from "bun:test"
import type { Clock } from "../../../src/core/clock"
import { OperationCancelledError } from "../../../src/core/errors"
import { createConnectorLogger } from "../../../src/core/logger"
import { CONNECTOR_AISDK_PACKAGE } from "../../../src/opencode/v2-catalog"
import { setupV2Connector } from "../../../src/opencode/v2-setup"
import { ClaudeCredentialLookupError } from "../../../src/providers/claude/auth"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { MemoryLogSink } from "../../support/log-sink"
import { enqueueCloudCatalog, enqueueCloudReference } from "../providers/ollama/cloud-fixtures"
import { FakeFetch, jsonResponse } from "../providers/ollama/http-fake"
import { createV2Host, credentialConnection, flushAsync } from "./v2-host"

it("isolates a locked Claude observation during V2 setup and revokes only its later binding", async () => {
  // Given
  const host = createV2Host({
    pluginOptions: {
      providers: ["claude", "command-code", "ollama"],
      catalogReloadMs: 0,
      health: { initialBackoffMs: 20, maximumBackoffMs: 40 },
    },
  })
  host.setConnection("anthropic", credentialConnection("claude-session", "key"))
  host.setKey("claude-session", "cli-session:anthropic")
  host.setConnection("command-code", credentialConnection("selected-command", "key"))
  host.setKey("selected-command", "direct-command")
  host.setConnection("ollama", credentialConnection("ollama-session", "key"))
  host.setKey("ollama-session", "cli-session:ollama")
  const clock = new FakeClock()
  const transport = new FakeHttpTransport()
  const http = new FakeFetch()
  const sink = new MemoryLogSink()
  let failing = true
  let lookups = 0
  const daemon = "http://localhost:11434/api/tags"
  for (let index = 0; index < 12; index += 1) {
    http.enqueue(daemon, jsonResponse({ models: [{ name: "local" }] }))
    enqueueCloudCatalog(http, ["cloud-model"])
    enqueueCloudReference(http, { hostedId: "cloud-model", referenceId: "cloud-model:cloud" })
  }
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode('{"data":[{"id":"command-model"}]}'),
  })
  const dependencies = {
    env: { ANTHROPIC_CLI_VERSION: "9.9.9", COMMAND_CODE_CLI_VERSION: "9.9.9", PATH: "" },
    clock,
    createTransport: () => transport,
    createLogger: (current: Clock) => createConnectorLogger(current, sink),
    ollamaFetch: http.fetch,
    claudeAuthLookup: {
      readKeychain: async () => {
        lookups += 1
        if (failing) throw new ClaudeCredentialLookupError("locked")
        return JSON.stringify({
          claudeAiOauth: {
            accessToken: "fixture-token",
            refreshToken: "fixture-refresh",
            expiresAt: 1_900_000_000_000,
          },
        })
      },
    },
  }
  // When
  const close = await setupV2Connector(host, dependencies)
  try {
    // Then
    expect(
      host
        .providers()
        .map((record) => `${record.provider.id}`)
        .sort(),
    ).toEqual(["command-code", "ollama"])
    expect(
      host
        .providers()
        .find((record) => record.provider.id === "command-code")
        ?.models.has("command-model"),
    ).toBe(true)
    expect(
      host
        .providers()
        .find((record) => record.provider.id === "ollama")
        ?.models.has("local"),
    ).toBe(true)
    host.emit("credential.updated")
    await flushAsync()
    expect(lookups).toBe(1)
    failing = false
    clock.advanceBy(20)
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"data":[{"id":"claude-model"}]}'),
    })
    host.emit("credential.updated")
    await flushAsync()
    expect(
      host
        .providers()
        .find((record) => record.provider.id === "claude")
        ?.models.has("claude-model"),
    ).toBe(true)
    const previous = host.hooks
      .find((hook) => hook.name === "language" && hook.providerID === "claude")
      ?.invoke({
        providerID: "claude",
        modelID: "claude-model",
        modelPackage: CONNECTOR_AISDK_PACKAGE,
      }).language
    expect(previous).toBeDefined()
    failing = true
    host.emit("credential.updated")
    await flushAsync()
    expect(host.providers().some((record) => record.provider.id === "claude")).toBe(false)
    expect(host.providers().some((record) => record.provider.id === "command-code")).toBe(true)
    expect(host.providers().some((record) => record.provider.id === "ollama")).toBe(true)
    if (previous === undefined) throw new TypeError("missing Claude binding")
    await expect(
      previous.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    ).rejects.toThrow()
    expect(sink.records.some((record) => record.event === "provider.credential.failed")).toBe(true)
    expect(JSON.stringify(sink.records)).not.toContain("locked")
  } finally {
    await close()
  }
})

it("keeps whole-lifetime cancellation distinct from a V2 credential failure", async () => {
  // Given
  const host = createV2Host({ pluginOptions: { providers: ["claude"], catalogReloadMs: 0 } })
  host.setConnection("anthropic", credentialConnection("claude-session", "key"))
  host.setKey("claude-session", "cli-session:anthropic")
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode('{"data":[{"id":"claude-model"}]}'),
  })
  const sink = new MemoryLogSink()
  const started = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<string | null>()
  let block = false
  const close = await setupV2Connector(host, {
    env: { ANTHROPIC_CLI_VERSION: "9.9.9", PATH: "" },
    clock: new FakeClock(),
    createTransport: () => transport,
    createLogger: (clock) => createConnectorLogger(clock, sink),
    claudeAuthLookup: {
      readKeychain: async () => {
        if (block) {
          started.resolve()
          return pending.promise
        }
        return JSON.stringify({
          claudeAiOauth: {
            accessToken: "fixture",
            refreshToken: "fixture-refresh",
            expiresAt: 1_900_000_000_000,
          },
        })
      },
    },
  })
  block = true
  host.emit("credential.updated")
  await started.promise
  // When
  const disposal = close()
  pending.reject(new OperationCancelledError("claude-read-credentials"))
  await disposal
  // Then
  expect(sink.records.some((record) => record.event === "provider.credential.failed")).toBe(false)
})
