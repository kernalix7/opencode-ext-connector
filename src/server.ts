import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { Hooks, Plugin as V1Plugin } from "@opencode-ai/plugin"

import { createAsyncDisposable } from "./core/lifecycle.js"
import { parseConnectorOptions } from "./core/options.js"
import { createFetchHttpTransport } from "./http/fetch-transport.js"
import { createConsoleLogger } from "./logging/logger.js"
import { createOpenCodeAuthStore } from "./opencode/auth-store.js"
import { startClaudeOwnerAuthority } from "./opencode/claude-authority.js"
import { pickConnectorOptionsInput, pickOllamaBaseURL } from "./opencode/host-options.js"
import { getProductionOllamaBundle } from "./opencode/ollama-production.js"
import { createProviderRegistry, selectConfiguredProviders } from "./opencode/providers.js"
import { buildV1AuthHooks, createV1AuthServer, createV1Server } from "./opencode/v1-module.js"
import { productionOllamaFetch } from "./providers/ollama/http.js"

const env = process.env
const transport = createFetchHttpTransport()
const authStore = createOpenCodeAuthStore({ env })
const clock = {
  nowMs: (): number => Date.now(),
  schedule: (delayMs: number, callback: () => void) => {
    const handle = setTimeout(callback, delayMs)
    handle.unref()
    const cancel = (): void => {
      clearTimeout(handle)
    }
    return {
      cancel,
      [Symbol.dispose]: cancel,
    }
  },
}
const logger = createConsoleLogger(clock)

const distDirectory = dirname(fileURLToPath(import.meta.url))
const npmSpecifiers: Record<string, string> = {
  claude: pathToFileURL(join(distDirectory, "sdk", "claude.js")).href,
  "command-code": pathToFileURL(join(distDirectory, "sdk", "command-code.js")).href,
  ollama: pathToFileURL(join(distDirectory, "sdk", "ollama.js")).href,
}

const registry = createProviderRegistry()
const providerDeps = {
  env,
  transport,
  clock,
  authStore,
  allowEnvironmentKeys: true,
}

export const connectorServer: V1Plugin = async (input, options): Promise<Hooks> => {
  const connectorOptions = parseConnectorOptions(pickConnectorOptionsInput(options))
  const ollama = connectorOptions.providers.includes("ollama")
    ? getProductionOllamaBundle(pickOllamaBaseURL(options))
    : undefined
  const providers = selectConfiguredProviders(
    createProviderRegistry({
      ...(ollama === undefined
        ? {}
        : {
            ollama: {
              fetch: productionOllamaFetch,
              catalog: ollama.catalog,
              endpoints: ollama.endpoints,
            },
          }),
    }),
    connectorOptions.providers,
  )
  const hooks = await createV1Server({
    clock,
    transport,
    authStore,
    env,
    providers,
    npmSpecifiers,
    snapshotTimeoutMs: connectorOptions.snapshotTimeoutMs,
    catalogReloadMs: connectorOptions.catalogReloadMs,
    health: connectorOptions.health,
    logger,
    credentialRefresh: connectorOptions.credentialRefresh,
    writeBackCredentials: connectorOptions.writeBackCredentials,
  })(input, options)
  const authority = startClaudeOwnerAuthority({
    authority: connectorOptions.credentialAuthority,
    env,
    clock,
    logger,
  })
  const dispose = hooks.dispose
  const disposal = createAsyncDisposable(async () => {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => dispose?.()),
      authority.dispose(),
    ])
    const primaryFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    if (primaryFailure !== undefined) throw primaryFailure.reason
  })
  return {
    ...hooks,
    dispose: disposal.dispose,
  }
}

const claudeEntry = registry.find((entry) => entry.id === "claude")
const commandCodeEntry = registry.find((entry) => entry.id === "command-code")

export const claudeAuthServer: V1Plugin =
  claudeEntry === undefined
    ? async (): Promise<Hooks> => ({})
    : createV1AuthServer(claudeEntry, providerDeps)

export const cursorAuthServer: V1Plugin = async (): Promise<Hooks> => ({})

export const commandCodeAuthServer: V1Plugin =
  commandCodeEntry === undefined
    ? async (): Promise<Hooks> => ({})
    : createV1AuthServer(commandCodeEntry, providerDeps)

export const ollamaAuthServer: V1Plugin = async (_input, options): Promise<Hooks> => {
  const connectorOptions = parseConnectorOptions(pickConnectorOptionsInput(options))
  if (!connectorOptions.providers.includes("ollama")) return {}
  const ollama = getProductionOllamaBundle(pickOllamaBaseURL(options))
  const entry = createProviderRegistry({
    ollama: {
      fetch: productionOllamaFetch,
      catalog: ollama.catalog,
      endpoints: ollama.endpoints,
    },
  }).find((candidate) => candidate.id === "ollama")
  return entry === undefined ? {} : buildV1AuthHooks(entry, providerDeps, options)
}

export const xaiAuthServer: V1Plugin = async (): Promise<Hooks> => ({})
