import { createClaudeAdapter } from "../providers/claude/adapter"
import { createClaudeTokenManager, readClaudeCredentials } from "../providers/claude/auth"
import { readClaudeCliVersion } from "../providers/claude/cli-version"
import type { ClaudeCredentials } from "../providers/claude/credentials"
import { listClaudeModels } from "../providers/claude/models"
import { createCommandCodeAdapter } from "../providers/command-code/adapter"
import { readCommandCodeAccessToken } from "../providers/command-code/auth"
import { listCommandCodeModels } from "../providers/command-code/models"
import { createCursorAdapter } from "../providers/cursor/adapter"
import { readCursorAccessToken } from "../providers/cursor/auth"
import { listCursorUsableModels } from "../providers/cursor/models"
import { createOllamaAdapter } from "../providers/ollama/adapter"
import type { OllamaCatalogState } from "../providers/ollama/catalog-state"
import { type OllamaFetch, productionOllamaFetch } from "../providers/ollama/http"
import { probeLocalOllama } from "./ollama-probe"
import { productionOllamaCatalog } from "./ollama-production"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry"
import { createAnthropicCliAuth } from "./v1-anthropic-auth"
import {
  createCommandCodeSessionAuth,
  createCursorSessionAuth,
  createOllamaSessionAuth,
} from "./v1-session-auth"

export type ProviderConnectionActive = (integrationId: string) => Promise<boolean>

export type ClaudeCredentialWriter = (
  env: Readonly<Record<string, string | undefined>>,
  credentials: ClaudeCredentials,
) => Promise<void>

export type ProviderRegistryOptions = {
  readonly writeClaudeCredentials?: ClaudeCredentialWriter
  readonly ollama?: {
    readonly fetch: OllamaFetch
    readonly catalog: OllamaCatalogState
  }
}

async function readCommandCodeToken(
  deps: ProviderEntryDeps,
  signal: AbortSignal,
): Promise<string | null> {
  const match = await deps.authStore.matchAuth("command-code")
  if (match === null) {
    return null
  }
  switch (match.kind) {
    case "api-key":
      return match.key
    case "marker":
      return readCommandCodeAccessToken(deps.env, signal)
    case "oauth":
      return null
  }
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
    if (await isActive(entry.integrationId)) {
      selected.push(entry)
    }
  }
  return selected
}

export function createProviderRegistry(
  options: ProviderRegistryOptions = {},
): readonly ProviderEntry[] {
  const writeClaudeCredentials = options.writeClaudeCredentials
  const ollama = options.ollama ?? {
    fetch: productionOllamaFetch,
    catalog: productionOllamaCatalog,
  }
  return [
    {
      id: "claude",
      displayName: "Claude",
      integrationId: "anthropic",
      integrationMethod: { type: "env", names: ["CLAUDE_EXT_CONNECTOR_ENABLED"] },
      createAdapter: (deps) =>
        createClaudeAdapter({
          readAccessToken: async (signal) => {
            const credentials = await readClaudeCredentials(deps.env, signal)
            return credentials?.accessToken ?? null
          },
          listModels: (token, signal) => {
            const version = readClaudeCliVersion(deps.env)
            return version === null
              ? Promise.resolve([])
              : listClaudeModels({ transport: deps.transport, token, signal, version })
          },
        }),
      createAuthHook: (deps) => {
        const tokenManager = createClaudeTokenManager({
          env: deps.env,
          clock: deps.clock,
          transport: deps.transport,
          ...(deps.writeBackCredentials && writeClaudeCredentials !== undefined
            ? {
                writeBack: (credentials) => writeClaudeCredentials(deps.env, credentials),
              }
            : {}),
        })
        return createAnthropicCliAuth({
          provider: "anthropic",
          readCredentials: (signal) => readClaudeCredentials(deps.env, signal),
          readAccessToken: tokenManager.readAccessToken,
          forceRefreshAccessToken: tokenManager.forceRefreshAccessToken,
          cliVersion: readClaudeCliVersion(deps.env),
        })
      },
      isConnected: async (deps) => {
        if ((await deps.authStore.matchAuth("anthropic")) === null) {
          return false
        }
        const signal = new AbortController().signal
        return (await readClaudeCredentials(deps.env, signal)) !== null
      },
    },
    {
      id: "cursor",
      displayName: "Cursor",
      integrationId: "cursor",
      integrationMethod: { type: "env", names: ["CURSOR_EXT_CONNECTOR_ENABLED"] },
      fallbackModelIds: ["default"],
      createAdapter: (deps) =>
        createCursorAdapter({
          readAccessToken: (signal) => readCursorAccessToken(deps.env, signal),
          listModels: (token, signal) => listCursorUsableModels(token, signal),
        }),
      createAuthHook: (deps) => createCursorSessionAuth(deps.env),
      isConnected: async (deps) =>
        (await deps.authStore.matchAuth("cursor")) !== null &&
        (await readCursorAccessToken(deps.env, new AbortController().signal)) !== null,
    },
    {
      id: "command-code",
      displayName: "Command Code",
      integrationId: "command-code",
      integrationMethod: { type: "env", names: ["COMMAND_CODE_API_KEY"] },
      fallbackModelIds: ["Qwen/Qwen3.8-Max"],
      createAdapter: (deps) =>
        createCommandCodeAdapter({
          readAccessToken: (signal) => readCommandCodeToken(deps, signal),
          listModels: (token, signal) => listCommandCodeModels(deps.transport, token, signal),
        }),
      createAuthHook: (deps) => createCommandCodeSessionAuth(deps.env),
      isConnected: async (deps) =>
        (await readCommandCodeToken(deps, new AbortController().signal)) !== null,
    },
    {
      id: "ollama",
      displayName: "Ollama",
      integrationId: "ollama",
      integrationMethod: { type: "env", names: ["OLLAMA_EXT_CONNECTOR_ENABLED"] },
      createAdapter: () => createOllamaAdapter(ollama),
      createAuthHook: () => createOllamaSessionAuth(ollama.fetch),
      isConnected: async (deps) => {
        if ((await deps.authStore.matchAuth("ollama")) === null) return false
        return probeLocalOllama(ollama.fetch)
      },
    },
  ]
}
