import { describe, expect, it } from "bun:test"

import { AdapterError } from "../../../src/core/errors"
import { CONNECTOR_AISDK_PACKAGE } from "../../../src/opencode/v2-catalog"
import { setupV2Connector, type V2SetupDependencies } from "../../../src/opencode/v2-setup"
import plugin from "../../../src/v2"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { createV2Host, credentialConnection } from "./v2-host"

function deps(transport: FakeHttpTransport): V2SetupDependencies {
  return {
    env: { COMMAND_CODE_CLI_VERSION: "9.9.9", PATH: "" },
    clock: new FakeClock(),
    createTransport: () => transport,
    createLogger: () => ({ log: () => undefined }),
  }
}

function catalog(transport: FakeHttpTransport): void {
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode(
      JSON.stringify({
        data: [{ id: "qwen-test" }],
      }),
    ),
  })
}

async function connected() {
  const host = createV2Host({ pluginOptions: { providers: ["command-code"], catalogReloadMs: 0 } })
  host.setConnection("command-code", credentialConnection("command-code", "key"))
  host.setKey("command-code", "fixture-key")
  const transport = new FakeHttpTransport()
  catalog(transport)
  const cleanup = await setupV2Connector(host, deps(transport))
  const language = host.hooks
    .find((hook) => hook.name === "language")
    ?.invoke({
      providerID: "command-code",
      modelID: "qwen-test",
      modelPackage: CONNECTOR_AISDK_PACKAGE,
    }).language
  if (language === undefined) throw new Error("Missing published language")
  return { host, transport, language, cleanup }
}

describe("official V2 setup", () => {
  it("preserves the default plugin entry definition", () => {
    // Given / When / Then
    expect(plugin.id).toBe("opencode-ext-connector")
    expect(typeof plugin.setup).toBe("function")
  })

  it("does not initialize an excluded daemon for an empty provider list", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: [], ollamaBaseURL: "not-a-url" } })
    // When
    const cleanup = await setupV2Connector(host, deps(new FakeHttpTransport()))
    // Then
    expect(host.methods).toHaveLength(0)
    expect(host.providers()).toHaveLength(0)
    await cleanup()
  })

  it("ignores a malformed daemon base when only Claude is selected", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: ["claude"], ollamaBaseURL: "://bad" } })
    // When
    const cleanup = await setupV2Connector(host, deps(new FakeHttpTransport()))
    // Then
    expect(host.methods.every((method) => method.integrationID === "anthropic")).toBe(true)
    await cleanup()
  })

  it("registers key/env methods and all SDK hooks before language hooks", async () => {
    // Given
    const host = createV2Host({
      pluginOptions: { providers: ["command-code", "claude"], catalogReloadMs: 0 },
    })
    // When
    const cleanup = await setupV2Connector(host, deps(new FakeHttpTransport()))
    // Then
    expect(host.methods.map((method) => method.method.type)).toEqual(["env", "key", "env", "key"])
    expect(host.hooks.findIndex((hook) => hook.name === "language")).toBeGreaterThan(
      host.hooks.findLastIndex((hook) => hook.name === "sdk"),
    )
    expect(
      host.hooks[0]?.invoke({
        providerID: "claude",
        modelID: "fixture",
        modelPackage: CONNECTOR_AISDK_PACKAGE,
      }).sdk,
    ).toEqual({ connector: "opencode-ext-connector" })
    await cleanup()
  })

  it.each(["", "cli-session:command-code"])(
    "does not publish a missing or retired key %s",
    async (key) => {
      // Given
      const host = createV2Host({
        pluginOptions: { providers: ["command-code"], catalogReloadMs: 0 },
      })
      host.setConnection("command-code", credentialConnection("command-code", "key"))
      host.setKey("command-code", key)
      // When
      const cleanup = await setupV2Connector(host, deps(new FakeHttpTransport()))
      // Then
      expect(host.providers()).toHaveLength(0)
      await cleanup()
    },
  )

  it("generates through the selected direct key on the existing Command Code protocol", async () => {
    // Given
    const state = await connected()
    state.transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
      body: new TextEncoder().encode('{"type":"text-delta","text":"hello"}\n{"type":"finish"}'),
    })
    // When
    const generated = await state.language.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // Then
    expect(generated.content).toContainEqual({ type: "text", text: "hello" })
    expect(state.transport.requests.at(-1)?.url).toBe("https://api.commandcode.ai/alpha/generate")
    expect(state.transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer fixture-key")
    await state.cleanup()
  })

  it.each(["generate", "stream"])(
    "rejects cached %s after the selected connection disappears",
    async (operation) => {
      // Given
      const state = await connected()
      state.host.setConnection("command-code", undefined)
      const input = {
        prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
      }
      // When
      const result =
        operation === "generate" ? state.language.doGenerate(input) : state.language.doStream(input)
      // Then
      await expect(result).rejects.toBeInstanceOf(AdapterError)
      expect(state.transport.requests).toHaveLength(1)
      await state.cleanup()
    },
  )
})
