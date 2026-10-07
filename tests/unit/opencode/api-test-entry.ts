import type { ProviderEntry } from "../../../src/opencode/provider-entry"
import { createClaudeAdapter } from "../../../src/providers/claude/api-adapter"
import { listClaudeModels } from "../../../src/providers/claude/api-models"

export function apiTestEntry(): ProviderEntry {
  return {
    id: "claude",
    displayName: "Claude API fixture",
    integrationId: "claude",
    integrationMethod: { type: "env", names: ["ANTHROPIC_API_KEY"] },
    route: "api",
    createAdapter: (deps) =>
      createClaudeAdapter({
        readApiKey: async () => {
          const match = await deps.authStore.matchAuth("claude")
          return match?.kind === "api-key" ? match.key : null
        },
        listModels: (apiKey, signal) =>
          listClaudeModels({ transport: deps.transport, apiKey, signal }),
      }),
    createAuthHook: () => ({ provider: "claude", methods: [] }),
    isConnected: async (deps) => (await deps.authStore.matchAuth("claude"))?.kind === "api-key",
  }
}
