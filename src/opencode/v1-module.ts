import type { Hooks, Plugin as V1Plugin } from "@opencode-ai/plugin"

import type { ProviderAdapter } from "../core/adapter.js"
import type { Clock } from "../core/clock.js"
import type { HealthPolicy } from "../core/health.js"
import type { HttpTransport } from "../core/http.js"
import { createAsyncDisposable } from "../core/lifecycle.js"
import type { ConnectorLogger } from "../core/logger.js"
import { parseConnectorOptions } from "../core/options.js"
import type { OpenCodeAuthStore } from "./auth-store.js"
import { type HealthStore, refreshAdaptersWithHealth } from "./health-refresh.js"
import { pickConnectorOptionsInput } from "./host-options.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import { scheduleCatalogReload } from "./reload.js"
import { createV1CatalogProjector } from "./v1-catalog.js"
import { createV1Owner } from "./v1-owner.js"

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
    allowEnvironmentKeys: true,
  }
}

export async function buildV1Hooks(options: V1ServerOptions): Promise<Hooks> {
  const deps = entryDeps(options)
  const providers: ProviderEntry[] = []
  for (const entry of options.providers) {
    if (entry.id === "ollama" && (await entry.isConnected(deps))) {
      providers.push(entry)
    }
  }
  const adapters: ProviderAdapter[] = providers.map((entry) => entry.createAdapter(deps))
  const projector = createV1CatalogProjector({
    entries: options.providers,
    ...(options.npmSpecifiers === undefined ? {} : { npmSpecifiers: options.npmSpecifiers }),
  })
  const lifetime = new AbortController()
  const apiOwner = createV1Owner({
    entries: options.providers,
    deps,
    projector,
    health: options.health ?? { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
    logger: options.logger ?? { log: () => undefined },
    snapshotTimeoutMs: options.snapshotTimeoutMs ?? 30_000,
    lifetime: lifetime.signal,
  })
  const healthStore: HealthStore = new Map()
  const refresh = async (): Promise<void> => {
    await apiOwner.refresh()
    await refreshAdaptersWithHealth({
      adapters,
      publisher: projector.publisher,
      logger: options.logger ?? { log: () => undefined },
      clock: options.clock,
      health: options.health ?? { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
      store: healthStore,
      signal: lifetime.signal,
      snapshotTimeoutMs: options.snapshotTimeoutMs ?? 30_000,
    })
  }
  try {
    await refresh()
  } catch (error: unknown) {
    lifetime.abort()
    await Promise.allSettled([apiOwner.dispose(), ...adapters.map((adapter) => adapter.dispose())])
    throw error
  }
  const reload = scheduleCatalogReload({
    clock: options.clock,
    intervalMs: options.catalogReloadMs ?? 300_000,
    reload: refresh,
  })
  const disposal = createAsyncDisposable(async () => {
    await reload.dispose()
    const results = await Promise.allSettled([
      apiOwner.dispose(),
      ...adapters.map((adapter) => adapter.dispose()),
    ])
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    if (failure !== undefined) throw failure.reason
  })
  return {
    config: async (config) => projector.attach(config),
    dispose: () => {
      lifetime.abort()
      void apiOwner.dispose().catch((error: unknown) => {
        options.logger?.log("warn", "v1.owner.cleanup-failed", {
          name: error instanceof Error ? error.name : "unknown",
        })
      })
      return disposal.dispose()
    },
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
