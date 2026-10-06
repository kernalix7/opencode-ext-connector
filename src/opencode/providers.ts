import { createClaudeAdapter } from "../providers/claude/api-adapter.js"
import { listClaudeModels } from "../providers/claude/api-models.js"
import { createCommandCodeAdapter } from "../providers/command-code/api-adapter.js"
import { listCommandCodeModels } from "../providers/command-code/api-models.js"
import { createOllamaAdapter } from "../providers/ollama/adapter.js"
import type { OllamaCatalogState } from "../providers/ollama/catalog-state.js"
import type { OllamaEndpoints } from "../providers/ollama/endpoints.js"
import { type OllamaFetch, productionOllamaFetch } from "../providers/ollama/http.js"
import { probeLocalOllama } from "./ollama-probe.js"
import { getProductionOllamaBundle } from "./ollama-production.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import { createApiKeyAuthHook } from "./v1-api-auth.js"
import { createOllamaSessionAuth } from "./v1-session-auth.js"

export type ProviderConnectionActive = (integrationId: string) => Promise<boolean>

export type ProviderRegistryOptions = {
  readonly ollama?: {
    readonly fetch: OllamaFetch
    readonly catalog: OllamaCatalogState
    readonly endpoints?: OllamaEndpoints
  }
}

export async function readProviderApiKey(
  deps: ProviderEntryDeps,
  provider: "claude" | "command-code",
  _signal: AbortSignal,
): Promise<string | null> {
  const match = await deps.authStore.matchAuth(provider)
  if (match?.kind === "api-key") return match.key
  if (match !== null || deps.allowEnvironmentKeys !== true) return null
  const key = deps.env[provider === "claude" ? "ANTHROPIC_API_KEY" : "COMMAND_CODE_API_KEY"]
  return key && !key.startsWith("cli-session:") ? key : null
}

export function selectConfiguredProviders(
  entries: readonly ProviderEntry[],
  providerIds: readonly string[],
): readonly ProviderEntry[] {
  const selected = new Set(providerIds)
  return entries.filter((entry) => selected.has(entry.id))
}

export async function selectActiveProviders(
  entries: readonly ProviderEntry[],
  isActive: ProviderConnectionActive,
): Promise<readonly ProviderEntry[]> {
  const selected: ProviderEntry[] = []
  for (const entry of entries) {
    if (await isActive(entry.integrationId)) selected.push(entry)
  }
  return selected
}

export function createProviderRegistry(
  options: ProviderRegistryOptions = {},
): readonly ProviderEntry[] {
  const productionOllama = getProductionOllamaBundle()
  const configuredOllama = options.ollama ?? {
    fetch: productionOllamaFetch,
    catalog: productionOllama.catalog,
    endpoints: productionOllama.endpoints,
  }
  const ollama = {
    ...configuredOllama,
    endpoints: configuredOllama.endpoints ?? productionOllama.endpoints,
  }
  return [
    {
      id: "claude",
      displayName: "Claude",
      integrationId: "claude",
      integrationMethod: { type: "env", names: ["ANTHROPIC_API_KEY"] },
      createAdapter: (deps) =>
        createClaudeAdapter({
          readApiKey: (signal) => readProviderApiKey(deps, "claude", signal),
          listModels: (apiKey, signal) =>
            listClaudeModels({ transport: deps.transport, apiKey, signal }),
        }),
      createAuthHook: () => createApiKeyAuthHook("claude"),
      isConnected: async (deps) =>
        (await readProviderApiKey(deps, "claude", new AbortController().signal)) !== null,
    },
    {
      id: "command-code",
      displayName: "Command Code",
      integrationId: "command-code",
      integrationMethod: { type: "env", names: ["COMMAND_CODE_API_KEY"] },
      createAdapter: (deps) =>
        createCommandCodeAdapter({
          readApiKey: (signal) => readProviderApiKey(deps, "command-code", signal),
          listModels: (apiKey, signal) =>
            listCommandCodeModels({ transport: deps.transport, apiKey, signal }),
        }),
      createAuthHook: () => createApiKeyAuthHook("command-code"),
      isConnected: async (deps) =>
        (await readProviderApiKey(deps, "command-code", new AbortController().signal)) !== null,
    },
    {
      id: "ollama",
      displayName: "Ollama",
      integrationId: "ollama",
      integrationMethod: { type: "env", names: ["OLLAMA_EXT_CONNECTOR_ENABLED"] },
      providerOptions: Object.freeze({ ollamaBaseURL: ollama.endpoints.baseURL }),
      createAdapter: () => createOllamaAdapter(ollama),
      createAuthHook: () => createOllamaSessionAuth(ollama.fetch, ollama.endpoints),
      isConnected: async (deps) => {
        if ((await deps.authStore.matchAuth("ollama")) === null) return false
        return probeLocalOllama(ollama.fetch, ollama.endpoints)
      },
    },
  ]
}
