import { createClaudeAdapter } from "../providers/claude/adapter.js"
import { readClaudeCredentialSource } from "../providers/claude/auth.js"
import { createClaudeVersionResolver } from "../providers/claude/cli-version.js"
import { listClaudeModels } from "../providers/claude/models.js"
import { createCommandCodeAdapter } from "../providers/command-code/adapter.js"
import { readCommandCodeCredentialSource } from "../providers/command-code/auth.js"
import { listCommandCodeModels } from "../providers/command-code/models.js"
import { createOllamaAdapter } from "../providers/ollama/adapter.js"
import type { OllamaCatalogState } from "../providers/ollama/catalog-state.js"
import type { OllamaEndpoints } from "../providers/ollama/endpoints.js"
import { type OllamaFetch, productionOllamaFetch } from "../providers/ollama/http.js"
import { probeLocalOllama } from "./ollama-probe.js"
import { getProductionOllamaBundle } from "./ollama-production.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import { createClaudeSessionAuth } from "./v1-claude-auth.js"
import { createCommandCodeSessionAuth, createOllamaSessionAuth } from "./v1-session-auth.js"

export type ProviderConnectionActive = (integrationId: string) => Promise<boolean>

export type ProviderRegistryOptions = {
  readonly ollama?: {
    readonly fetch: OllamaFetch
    readonly catalog: OllamaCatalogState
    readonly endpoints?: OllamaEndpoints
  }
}

export async function readProviderAccessToken(
  deps: ProviderEntryDeps,
  provider: "claude" | "command-code",
  _signal: AbortSignal,
): Promise<string | null> {
  const match = await deps.authStore.matchAuth(provider)
  if (match === null) return null
  if (provider === "command-code") {
    if (match.kind === "api-key") return match.key
    if (match.kind !== "marker") return null
    return (await readCommandCodeCredentialSource(deps.env, _signal))?.accessToken ?? null
  }
  if (match.kind !== "marker" && match.kind !== "oauth") return null
  return (
    (await readClaudeCredentialSource(deps.env, _signal, deps.claudeAuthLookup))?.credentials
      .accessToken ?? null
  )
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
      integrationId: "anthropic",
      route: "subscription",
      integrationMethod: { type: "env", names: ["CLAUDE_EXT_CONNECTOR_ENABLED"] },
      createAdapter: (deps) =>
        createClaudeAdapter({
          readAccessToken: (signal) =>
            deps.readAccessToken?.(signal) ?? readProviderAccessToken(deps, "claude", signal),
          listModels: async (token, signal) => {
            const version = await createClaudeVersionResolver({
              env: deps.env,
              transport: deps.transport,
            })(signal)
            return version === null
              ? []
              : listClaudeModels({ transport: deps.transport, token, version, signal })
          },
        }),
      createAuthHook: (deps) => createClaudeSessionAuth(deps),
      isConnected: async (deps) =>
        (await readProviderAccessToken(deps, "claude", new AbortController().signal)) !== null,
    },
    {
      id: "command-code",
      displayName: "Command Code",
      integrationId: "command-code",
      route: "subscription",
      integrationMethod: {
        type: "env",
        names: ["COMMAND_CODE_API_KEY", "COMMAND_CODE_EXT_CONNECTOR_ENABLED"],
      },
      createAdapter: (deps) =>
        createCommandCodeAdapter({
          readAccessToken: (signal) =>
            deps.readAccessToken?.(signal) ?? readProviderAccessToken(deps, "command-code", signal),
          listModels: (token, signal) => listCommandCodeModels(deps.transport, token, signal),
        }),
      createAuthHook: (deps) => createCommandCodeSessionAuth(deps.env),
      isConnected: async (deps) =>
        (await readProviderAccessToken(deps, "command-code", new AbortController().signal)) !==
        null,
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
