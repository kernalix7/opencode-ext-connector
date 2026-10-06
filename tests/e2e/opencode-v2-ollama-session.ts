import {
  endpointFrom,
  listIntegrations,
  listPlugins,
  OpenCodeV2WaitError,
  readUntil,
} from "../support/opencode-v2-api"
import type { OpenCodeV2Session } from "../support/opencode-v2-session"

const pluginId = "opencode-ext-connector"

export async function waitForPlugin(session: OpenCodeV2Session): Promise<void> {
  await listIntegrations(endpointFrom(session))
  try {
    await readUntil({
      label: "connector plugin",
      read: () => listPlugins(endpointFrom(session)),
      ready: (items) => items.some((item) => item.id === pluginId && item.status === "active"),
      timeoutMs: 15_000,
    })
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

export function ollamaConfig(plugin: string, ollamaBaseURL: string) {
  return {
    share: "disabled" as const,
    update: "disable" as const,
    plugins: [
      {
        package: plugin,
        options: {
          providers: ["ollama"] as const,
          ollamaBaseURL,
          catalogReloadMs: 0 as const,
        },
      },
    ],
  }
}
