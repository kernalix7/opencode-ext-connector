import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { cloudDiscoveryResponses } from "../support/cloud-discovery-fixture"
import {
  connectIntegrationKey,
  endpointFrom,
  generateText,
  listIntegrations,
  listModels,
  readUntil,
} from "../support/opencode-v2-api"
import { type PackedV2Plugin, packV2Plugin } from "../support/opencode-v2-packed"
import {
  openCodeV2Binary,
  requireOpenCodeV2Binary,
  runOpenCodeV2,
} from "../support/opencode-v2-session"
import {
  cloudFixturePlugin,
  contactedOllamaCloud,
  ollamaChatText,
  ollamaCloudModelName,
  ollamaDaemonPrefix,
  ollamaModelName,
  startEgressRecorder,
  startLoopbackDaemon,
} from "./opencode-v2-ollama-fixture"
import { ollamaConfig, waitForPlugin } from "./opencode-v2-ollama-session"

const providerId = "ollama"
const integrationId = "ollama"
const sessionMarker = "cli-session:ollama"

describe.skipIf(openCodeV2Binary() === undefined)("OpenCode V2 loopback Ollama runtime", () => {
  let packed: PackedV2Plugin
  beforeAll(async () => {
    packed = await packV2Plugin()
  }, 30_000)
  afterAll(async () => {
    await packed?.cleanup()
  })
  it("registers the marker connection and local catalog without contacting Ollama Cloud", async () => {
    // Given
    const binary = requireOpenCodeV2Binary()
    const daemon = startLoopbackDaemon()
    const egress = await startEgressRecorder()
    try {
      const plugin = await cloudFixturePlugin(packed, daemon)
      // When
      await runOpenCodeV2({
        binary,
        config: ollamaConfig(plugin, daemon.baseURL),
        fixtureEnv: {
          PATH: process.env["PATH"] ?? "",
          HTTP_PROXY: egress.proxyUrl,
          HTTPS_PROXY: egress.proxyUrl,
          NO_PROXY: "127.0.0.1,localhost",
        },
        run: async (session) => {
          await waitForPlugin(session)
          const endpoint = endpointFrom(session)
          await connectIntegrationKey({
            endpoint,
            integrationID: integrationId,
            key: sessionMarker,
          })
          const integrations = await listIntegrations(endpoint)
          const models = await readUntil({
            label: "loopback ollama model",
            read: () => listModels(endpoint),
            ready: (items) =>
              items.some(
                (item) => item.providerID === providerId && item.modelID === ollamaModelName,
              ),
            timeoutMs: 15_000,
          })

          // Then
          const ollama = integrations.find((item) => item.id === integrationId)
          const connected = ollama?.connections.some(
            (item) => item.type === "credential" && item.method === "key",
          )
          expect(connected).toBe(true)
          expect(
            models.some(
              (item) => item.providerID === providerId && item.modelID === ollamaModelName,
            ),
          ).toBe(true)
          expect(
            daemon.requests().some((item) => item.pathname === `${ollamaDaemonPrefix}/api/tags`),
          ).toBe(true)
          expect(daemon.requests().every((item) => !item.hasAuthorization && !item.hasCookie)).toBe(
            true,
          )
          expect(contactedOllamaCloud(egress.hosts())).toBe(false)
          expect(egress.hosts()).toEqual([])
          expect(
            models.some(
              (item) => item.modelID === ollamaCloudModelName && item.providerID === providerId,
            ),
          ).toBe(true)
          expect([...new Set(daemon.cloudRequests().map((item) => item.url))]).toEqual(
            Object.keys(cloudDiscoveryResponses),
          )
          expect(
            daemon
              .cloudRequests()
              .every(
                (item) =>
                  item.credentials === "omit" &&
                  item.method === "GET" &&
                  item.redirect === "error" &&
                  !("authorization" in item.headers) &&
                  !("cookie" in item.headers),
              ),
          ).toBe(true)
        },
      })
    } finally {
      await daemon.stop()
      await egress.stop()
    }
  }, 40_000)

  it.each([ollamaModelName, ollamaCloudModelName])(
    "returns one loopback chat completion for connected model %s",
    async (selectedModel) => {
      // Given
      const binary = requireOpenCodeV2Binary()
      const daemon = startLoopbackDaemon()
      const egress = await startEgressRecorder()
      try {
        const plugin = await cloudFixturePlugin(packed, daemon)
        // When
        await runOpenCodeV2({
          binary,
          config: ollamaConfig(plugin, daemon.baseURL),
          fixtureEnv: {
            PATH: process.env["PATH"] ?? "",
            HTTP_PROXY: egress.proxyUrl,
            HTTPS_PROXY: egress.proxyUrl,
            NO_PROXY: "127.0.0.1,localhost",
          },
          run: async (session) => {
            await waitForPlugin(session)
            const endpoint = endpointFrom(session)
            await connectIntegrationKey({
              endpoint,
              integrationID: integrationId,
              key: sessionMarker,
            })
            await readUntil({
              label: "connected loopback ollama model",
              read: () => listModels(endpoint),
              ready: (items) =>
                items.some(
                  (item) =>
                    item.providerID === providerId &&
                    item.modelID === selectedModel &&
                    item.enabled,
                ),
              timeoutMs: 15_000,
            })
            const text = await generateText({
              endpoint,
              modelID: selectedModel,
              prompt: "reply with the fixture token",
              providerID: providerId,
            })

            // Then
            expect(text).toBe(ollamaChatText)
            expect(
              daemon
                .requests()
                .filter((item) => item.pathname === `${ollamaDaemonPrefix}/api/chat`),
            ).toHaveLength(1)
            expect(contactedOllamaCloud(egress.hosts())).toBe(false)
            expect(egress.hosts()).toEqual([])
            expect(
              daemon.requests().every((item) => !item.hasAuthorization && !item.hasCookie),
            ).toBe(true)
            const pulls = daemon
              .requests()
              .filter((item) => item.pathname === `${ollamaDaemonPrefix}/api/pull`)
            expect(pulls.map((item) => item.model)).toEqual(
              selectedModel === ollamaCloudModelName ? [ollamaCloudModelName] : [],
            )
            expect(
              daemon
                .requests()
                .filter((item) => item.pathname === `${ollamaDaemonPrefix}/api/chat`)
                .map((item) => item.model),
            ).toEqual([selectedModel])
            expect([...new Set(daemon.cloudRequests().map((item) => item.url))]).toEqual(
              Object.keys(cloudDiscoveryResponses),
            )
            expect(
              daemon
                .cloudRequests()
                .every(
                  (item) =>
                    item.credentials === "omit" &&
                    item.method === "GET" &&
                    item.redirect === "error" &&
                    !("authorization" in item.headers) &&
                    !("cookie" in item.headers),
                ),
            ).toBe(true)
          },
        })
      } finally {
        await daemon.stop()
        await egress.stop()
      }
    },
    40_000,
  )
})
