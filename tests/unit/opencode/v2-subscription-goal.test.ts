import { expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { HttpResponse } from "../../../src/core/http"

import { ModelV2 } from "../../../src/opencode/beta-api"
import { CONNECTOR_AISDK_PACKAGE } from "../../../src/opencode/v2-catalog"
import { setupV2Connector } from "../../../src/opencode/v2-setup"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { createV2Host, credentialConnection, type V2Host } from "./v2-host"

const fixtures = [
  {
    provider: "claude",
    integration: "anthropic",
    marker: "cli-session:anthropic",
    modelId: "fixture-claude",
    generationPath: "/v1/messages",
    token: "synthetic-claude",
  },
  {
    provider: "command-code",
    integration: "command-code",
    marker: "cli-session:command-code",
    modelId: "fixture-command",
    generationPath: "/alpha/generate",
    token: "synthetic-command",
  },
] as const

type ProviderFixture = (typeof fixtures)[number]

async function credentialHome() {
  const home = await mkdtemp(join(tmpdir(), "connector-v2-subscription-"))
  await mkdir(join(home, ".commandcode"), { mode: 0o700 })
  await writeFile(
    join(home, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "synthetic-claude",
        refreshToken: "synthetic-refresh",
        expiresAt: 1_900_000_000_000,
      },
    }),
    { mode: 0o600 },
  )
  await writeFile(join(home, ".commandcode", "auth.json"), '{"apiKey":"synthetic-command"}', {
    mode: 0o600,
  })
  return {
    env: {
      HOME: home,
      CLAUDE_CONFIG_DIR: home,
      ANTHROPIC_CLI_VERSION: "9.9.9",
      COMMAND_CODE_CLI_VERSION: "9.9.9",
      PATH: "",
    },
    [Symbol.asyncDispose]: async () => rm(home, { recursive: true, force: true }),
  }
}

function selectedHost(fixture: ProviderFixture): V2Host {
  const host = createV2Host({
    pluginOptions: { providers: [fixture.provider], credentialRole: "reader", catalogReloadMs: 0 },
  })
  const connection = `${fixture.provider}-session`
  host.setConnection(fixture.integration, credentialConnection(connection, "key"))
  host.setKey(connection, fixture.marker)
  return host
}

function enqueueCatalog(transport: FakeHttpTransport, fixture: ProviderFixture): void {
  transport.enqueueResponse({
    status: 200,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify({ data: [{ id: fixture.modelId }] })),
  })
}

function generationResponse(fixture: ProviderFixture): HttpResponse {
  switch (fixture.provider) {
    case "claude":
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(
          JSON.stringify({
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            model: fixture.modelId,
            content: [{ type: "text", text: "fixture-output" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        ),
      }
    case "command-code":
      return {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
        body: new TextEncoder().encode(
          [
            '{"type":"start"}',
            '{"type":"text-delta","text":"fixture-output"}',
            '{"type":"finish","finishReason":"stop","totalUsage":{}}',
          ].join("\n"),
        ),
      }
    default: {
      const unreachable: never = fixture
      return unreachable
    }
  }
}

it.each([...fixtures])(
  "publishes actual default $provider catalog from marker and file-only credentials",
  async (fixture) => {
    // Given
    await using home = await credentialHome()
    const host = selectedHost(fixture)
    const transport = new FakeHttpTransport()
    enqueueCatalog(transport, fixture)
    const dependencies = {
      env: home.env,
      clock: new FakeClock(),
      createTransport: () => transport,
      claudeAuthLookup: { readKeychain: async () => null },
    }
    // When
    const close = await setupV2Connector(host, dependencies)
    try {
      // Then
      expect(
        host
          .providers()
          .find((record) => record.provider.id === fixture.provider)
          ?.models.has(ModelV2.ID.make(fixture.modelId)),
      ).toBe(true)
      expect(transport.requests[0]?.headers["authorization"]).toBe(`Bearer ${fixture.token}`)
      expect(
        transport.requests.every((request) => request.headers["x-api-key"] === undefined),
      ).toBe(true)
      expect(JSON.stringify(host.providers())).not.toContain(fixture.token)
    } finally {
      await close()
    }
  },
)

it("streams text and tool calls through the selected Command Code session", async () => {
  // Given
  await using home = await credentialHome()
  const fixture = fixtures[1]
  const host = selectedHost(fixture)
  const transport = new FakeHttpTransport()
  enqueueCatalog(transport, fixture)
  const close = await setupV2Connector(host, {
    env: home.env,
    clock: new FakeClock(),
    createTransport: () => transport,
    claudeAuthLookup: { readKeychain: async () => null },
  })
  try {
    const model = host.hooks
      .find(
        (candidate) => candidate.name === "language" && candidate.providerID === fixture.provider,
      )
      ?.invoke({
        providerID: fixture.provider,
        modelID: fixture.modelId,
        modelPackage: CONNECTOR_AISDK_PACKAGE,
      }).language
    if (model === undefined) throw new Error("Subscription model missing")
    transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
      body: new TextEncoder().encode(
        [
          '{"type":"text-delta","text":"streamed"}',
          '{"type":"tool-call","toolCallId":"call-1","toolName":"Read","input":{"path":"fixture"}}',
          '{"type":"finish","finishReason":"tool_calls"}',
        ].join("\n"),
      ),
    })
    // When
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }],
    })
    const parts = await Array.fromAsync(stream)
    // Then
    expect(parts).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "streamed" }))
    expect(parts).toContainEqual(expect.objectContaining({ type: "tool-call", toolName: "Read" }))
    expect(transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer synthetic-command")
  } finally {
    await close()
  }
})

it.each([...fixtures])(
  "generates through actual default $provider subscription hooks without API environment keys",
  async (fixture) => {
    // Given
    await using home = await credentialHome()
    const host = selectedHost(fixture)
    const transport = new FakeHttpTransport()
    enqueueCatalog(transport, fixture)
    const dependencies = {
      env: home.env,
      clock: new FakeClock(),
      createTransport: () => transport,
      claudeAuthLookup: { readKeychain: async () => null },
    }
    const close = await setupV2Connector(host, dependencies)
    try {
      const hook = host.hooks.find(
        (candidate) => candidate.name === "language" && candidate.providerID === fixture.provider,
      )
      const model = hook?.invoke({
        providerID: fixture.provider,
        modelID: fixture.modelId,
        modelPackage: CONNECTOR_AISDK_PACKAGE,
      }).language
      if (model === undefined) throw new Error("Default subscription model was not published")
      transport.enqueueResponse(generationResponse(fixture))
      // When
      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "fixture-input" }] }],
      })
      // Then
      expect(result.content).toEqual([{ type: "text", text: "fixture-output" }])
      const request = transport.requests.at(-1)
      if (request === undefined) throw new Error("No subscription request was emitted")
      expect(request.headers["authorization"]).toBe(`Bearer ${fixture.token}`)
      expect(request.headers["x-api-key"]).toBeUndefined()
      expect(new URL(request.url).pathname).toBe(fixture.generationPath)
      expect(transport.requests.some((entry) => entry.url.includes("oauth/token"))).toBe(false)
    } finally {
      await close()
    }
  },
)
