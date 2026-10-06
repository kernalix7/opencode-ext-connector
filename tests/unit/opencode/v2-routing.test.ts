import { describe, expect, it } from "bun:test"

import { createConnectorLogger } from "../../../src/core/logger"
import { CONNECTOR_AISDK_PACKAGE } from "../../../src/opencode/v2-catalog"
import { setupV2Connector } from "../../../src/opencode/v2-setup"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { MemoryLogSink } from "../../support/log-sink"
import { createV2Host, credentialConnection } from "./v2-host"

async function connectedHost() {
  const host = createV2Host({
    pluginOptions: { providers: ["command-code"], catalogReloadMs: 0 },
  })
  host.setConnection("command-code", credentialConnection("command-code", "key"))
  host.setKey("command-code", "test-key")
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
  return { host, cleanup }
}

describe("V2 generation package routing", () => {
  it("routes published models through scoped AISDK hooks when the SDK locator is stripped", async () => {
    // Given
    const { host, cleanup } = await connectedHost()
    try {
      const record = host.providers()[0]
      const model = record?.models.get("qwen-test")
      if (record === undefined || model === undefined) throw new Error("missing published model")
      if (model.package === undefined) throw new Error("missing published package")
      const sdk = host.hooks.find(
        (hook) => hook.name === "sdk" && hook.providerID === model.providerID,
      )
      const language = host.hooks.find(
        (hook) => hook.name === "language" && hook.providerID === model.providerID,
      )

      // When: CLI 2.0.20 dispatches AISDK packages by this prefix.
      const routed = model.package?.startsWith("aisdk:") === true
      const input = {
        providerID: model.providerID,
        modelID: model.id,
        modelPackage: model.package,
        packageName: CONNECTOR_AISDK_PACKAGE.slice("aisdk:".length),
      }
      const sdkResult = routed ? sdk?.invoke(input) : undefined
      const languageResult = routed ? language?.invoke(input) : undefined

      // Then
      expect(record.provider.package?.startsWith("aisdk:")).toBe(true)
      expect(sdkResult?.sdk).toEqual({ connector: "opencode-ext-connector" })
      expect(languageResult?.language?.specificationVersion).toBe("v3")
      expect(languageResult?.language?.modelId).toBe("qwen-test")
    } finally {
      await cleanup()
    }
  })

  it.each([
    "opencode-ext-connector",
    "aisdk:opencode-ext-connector",
    `${CONNECTOR_AISDK_PACKAGE}/other`,
    `other:${CONNECTOR_AISDK_PACKAGE}`,
    "other:aisdk:opencode-ext-connector",
    "aisdk:other/opencode-ext-connector",
    "aisdk:opencode-ext-connector/other",
    "@ai-sdk/openai",
    undefined,
  ])("does not claim model package %s even when the SDK locator matches", async (modelPackage) => {
    // Given
    const { host, cleanup } = await connectedHost()
    try {
      const input = {
        providerID: "command-code",
        modelID: "qwen-test",
        ...(modelPackage === undefined ? {} : { modelPackage }),
        packageName: CONNECTOR_AISDK_PACKAGE.slice("aisdk:".length),
      }

      // When
      const results = host.hooks.map((hook) => hook.invoke(input))

      // Then
      expect(results.every((result) => result.sdk === undefined)).toBe(true)
      expect(results.every((result) => result.language === undefined)).toBe(true)
    } finally {
      await cleanup()
    }
  })
})
