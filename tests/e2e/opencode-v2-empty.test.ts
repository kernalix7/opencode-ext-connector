import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import {
  endpointFrom,
  listIntegrations,
  listPlugins,
  listProviders,
  OpenCodeV2WaitError,
  readUntil,
} from "../support/opencode-v2-api"
import { type PackedV2Plugin, packV2Plugin } from "../support/opencode-v2-packed"
import {
  type OpenCodeV2Session,
  openCodeV2Binary,
  requireOpenCodeV2Binary,
  runOpenCodeV2,
} from "../support/opencode-v2-session"

const pluginId = "opencode-ext-connector"
const providerId = "ollama"

async function activePlugins(session: OpenCodeV2Session): Promise<readonly string[]> {
  const endpoint = endpointFrom(session)
  await listIntegrations(endpoint)
  try {
    const plugins = await readUntil({
      label: "connector plugin",
      read: () => listPlugins(endpoint),
      ready: (items) => items.some((item) => item.id === pluginId && item.status === "active"),
      timeoutMs: 15_000,
    })
    return plugins.flatMap((item) => (item.id === undefined ? [] : [item.id]))
  } catch (error: unknown) {
    if (error instanceof OpenCodeV2WaitError) {
      throw new OpenCodeV2WaitError(
        `${error.label}: ${session.server.diagnostics()}`,
        error.timeoutMs,
      )
    }
    throw error
  }
}

function emptyConfig(plugin: string): {
  readonly plugins: readonly [
    {
      readonly package: string
      readonly options: {
        readonly catalogReloadMs: 0
        readonly providers: readonly []
      }
    },
  ]
  readonly share: "disabled"
  readonly update: "disable"
} {
  return {
    share: "disabled",
    update: "disable",
    plugins: [
      {
        package: plugin,
        options: { providers: [], catalogReloadMs: 0 },
      },
    ],
  }
}

describe.skipIf(openCodeV2Binary() === undefined)("OpenCode V2 empty provider runtime", () => {
  let packed: PackedV2Plugin
  beforeAll(async () => {
    packed = await packV2Plugin()
  }, 30_000)
  afterAll(async () => {
    await packed?.cleanup()
  })
  it("activates the packed connector plugin when providers is empty", async () => {
    // Given
    const binary = requireOpenCodeV2Binary()
    const plugin = packed.packageUrl

    // When
    await runOpenCodeV2({
      binary,
      config: emptyConfig(plugin),
      run: async (session) => {
        const ids = await activePlugins(session)

        // Then
        expect(ids).toContain(pluginId)
      },
    })
  }, 30_000)

  it("publishes no connector Ollama provider or integration when providers is empty", async () => {
    // Given
    const binary = requireOpenCodeV2Binary()
    const plugin = packed.packageUrl

    // When
    await runOpenCodeV2({
      binary,
      config: emptyConfig(plugin),
      run: async (session) => {
        await activePlugins(session)
        const endpoint = endpointFrom(session)
        const providers = await listProviders(endpoint)
        const integrations = await listIntegrations(endpoint)

        // Then
        expect(providers.some((provider) => provider.id === providerId)).toBe(false)
        expect(integrations.some((integration) => integration.id === providerId)).toBe(false)
      },
    })
  }, 30_000)

  it("stops listening after the owned server is closed", async () => {
    // Given
    const binary = requireOpenCodeV2Binary()
    const plugin = packed.packageUrl

    // When
    await runOpenCodeV2({
      binary,
      config: emptyConfig(plugin),
      run: async (session) => {
        const url = session.server.url
        await session.server.close()

        // Then
        expect(session.server.exitCode).toBe(await session.server.exited)
        await expect(fetch(url, { signal: AbortSignal.timeout(1_000) })).rejects.toBeDefined()
      },
    })
  }, 30_000)
})
