import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { Hooks, Plugin as V1Plugin } from "@opencode-ai/plugin"

import { createAsyncDisposable } from "./core/lifecycle"
import { parseConnectorOptions } from "./core/options"
import { createFetchHttpTransport } from "./http/fetch-transport"
import { createConsoleLogger } from "./logging/logger"
import { createOpenCodeAuthStore } from "./opencode/auth-store"
import { pickConnectorOptionsInput } from "./opencode/host-options"
import { createProviderRegistry, selectConfiguredProviders } from "./opencode/providers"
import { disposeV1LanguageRuntime } from "./opencode/v1-language"
import { createV1AuthServer, createV1Server } from "./opencode/v1-module"
import { writeClaudeCredentials } from "./providers/claude/writeback"

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
  cursor: pathToFileURL(join(distDirectory, "sdk", "cursor.js")).href,
  "command-code": pathToFileURL(join(distDirectory, "sdk", "command-code.js")).href,
  ollama: pathToFileURL(join(distDirectory, "sdk", "ollama.js")).href,
}

const registry = createProviderRegistry({ writeClaudeCredentials })
const providerDeps = {
  env,
  transport,
  clock,
  authStore,
  writeBackCredentials: false,
}

export const connectorServer: V1Plugin = async (input, options): Promise<Hooks> => {
  const connectorOptions = parseConnectorOptions(pickConnectorOptionsInput(options))
  const providers = selectConfiguredProviders(registry, connectorOptions.providers)
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
  })(input, options)
  const dispose = hooks.dispose
  const disposal = createAsyncDisposable(async () => {
    try {
      await dispose?.()
    } finally {
      await disposeV1LanguageRuntime()
    }
  })
  return {
    ...hooks,
    dispose: disposal.dispose,
  }
}

const claudeEntry = registry.find((entry) => entry.id === "claude")
const cursorEntry = registry.find((entry) => entry.id === "cursor")
const commandCodeEntry = registry.find((entry) => entry.id === "command-code")
const ollamaEntry = registry.find((entry) => entry.id === "ollama")

export const claudeAuthServer: V1Plugin =
  claudeEntry === undefined
    ? async (): Promise<Hooks> => ({})
    : createV1AuthServer(claudeEntry, providerDeps)

export const cursorAuthServer: V1Plugin =
  cursorEntry === undefined
    ? async (): Promise<Hooks> => ({})
    : createV1AuthServer(cursorEntry, providerDeps)

export const commandCodeAuthServer: V1Plugin =
  commandCodeEntry === undefined
    ? async (): Promise<Hooks> => ({})
    : createV1AuthServer(commandCodeEntry, providerDeps)

export const ollamaAuthServer: V1Plugin =
  ollamaEntry === undefined
    ? async (): Promise<Hooks> => ({})
    : createV1AuthServer(ollamaEntry, providerDeps)

export type ConnectorPluginModule = {
  readonly id: "opencode-ext-connector"
  readonly server: V1Plugin
}

export const plugin: ConnectorPluginModule = {
  id: "opencode-ext-connector",
  server: connectorServer,
}

export default plugin
