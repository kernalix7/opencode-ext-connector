import type { Hooks, Plugin as V1Plugin } from "@opencode-ai/plugin"

import type { ProviderAdapter } from "../core/adapter"
import type { Clock } from "../core/clock"
import type { HealthPolicy } from "../core/health"
import type { HttpTransport } from "../core/http"
import { createAsyncDisposable } from "../core/lifecycle"
import type { ConnectorLogger } from "../core/logger"
import { parseConnectorOptions } from "../core/options"
import type { OpenCodeAuthStore } from "./auth-store"
import { type HealthStore, refreshAdaptersWithHealth } from "./health-refresh"
import { pickConnectorOptionsInput } from "./host-options"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry"
import { scheduleCatalogReload } from "./reload"
import { createV1CatalogProjector } from "./v1-catalog"

export type V1ServerOptions = {
  readonly clock: Clock
  readonly transport: HttpTransport
  readonly authStore: OpenCodeAuthStore
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly providers: readonly ProviderEntry[]
  readonly snapshotTimeoutMs?: number
  readonly catalogReloadMs?: number
  readonly health?: HealthPolicy
  readonly logger?: ConnectorLogger
  readonly npmSpecifiers?: Readonly<Record<string, string>>
}

function entryDeps(options: V1ServerOptions): ProviderEntryDeps {
  return {
    env: options.env ?? process.env,
    transport: options.transport,
    clock: options.clock,
    authStore: options.authStore,
    writeBackCredentials: false,
  }
}

export async function buildV1Hooks(options: V1ServerOptions): Promise<Hooks> {
  const deps = entryDeps(options)
  const providers: ProviderEntry[] = []
  for (const entry of options.providers) {
    if (await entry.isConnected(deps)) {
      providers.push(entry)
    }
  }
  const adapters: ProviderAdapter[] = providers.map((entry) => entry.createAdapter(deps))
  const projector = createV1CatalogProjector({
    entries: providers,
    ...(options.npmSpecifiers === undefined ? {} : { npmSpecifiers: options.npmSpecifiers }),
  })
  const lifetime = new AbortController()
  const healthStore: HealthStore = new Map()
  const refresh = (): Promise<void> =>
    refreshAdaptersWithHealth({
      adapters,
      publisher: projector.publisher,
      logger: options.logger ?? { log: () => undefined },
      clock: options.clock,
      health: options.health ?? { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
      store: healthStore,
      signal: lifetime.signal,
      snapshotTimeoutMs: options.snapshotTimeoutMs ?? 30_000,
    })
  await refresh()
  const reload = scheduleCatalogReload({
    clock: options.clock,
    intervalMs: options.catalogReloadMs ?? 300_000,
    reload: refresh,
  })
  const disposal = createAsyncDisposable(async () => {
    lifetime.abort()
    await reload.dispose()
    await Promise.all(adapters.map((adapter) => adapter.dispose()))
  })
  return {
    config: async (config) => projector.attach(config),
    dispose: disposal.dispose,
  }
}

export function buildV1AuthHooks(
  entry: ProviderEntry,
  deps: ProviderEntryDeps,
  options: unknown,
): Hooks {
  const configured = parseConnectorOptions(pickConnectorOptionsInput(options))
  return configured.providers.some((providerId) => providerId === entry.id)
    ? {
        auth: entry.createAuthHook({
          ...deps,
          writeBackCredentials: configured.writeBackCredentials,
        }),
      }
    : {}
}

export function createV1AuthServer(entry: ProviderEntry, deps: ProviderEntryDeps): V1Plugin {
  return async (_input, options): Promise<Hooks> => buildV1AuthHooks(entry, deps, options)
}

export function createV1Server(options: V1ServerOptions): V1Plugin {
  return async (): Promise<Hooks> => buildV1Hooks(options)
}
