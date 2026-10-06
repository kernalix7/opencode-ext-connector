import type { ProviderAdapter } from "../core/adapter.js"
import type { Clock } from "../core/clock.js"
import { OperationCancelledError } from "../core/errors.js"
import type { HealthPolicy } from "../core/health.js"
import { parseProviderId } from "../core/ids.js"
import type { ConnectorLogger } from "../core/logger.js"
import type { OpenCodeAuthProvider } from "./auth-store.js"
import { PluginV2ClientError, type PluginV2ConnectionInfo } from "./beta-api.js"
import { type HealthStore, refreshAdaptersWithHealth } from "./health-refresh.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import { scheduleCatalogReload } from "./reload.js"
import type { V2ConnectionSource } from "./v2-auth.js"
import type { V2Catalog } from "./v2-catalog.js"

const catalogEvents = [
  "credential.switched",
  "credential.updated",
  "integration.updated",
  "provider.updated",
] as const

function authProvider(entry: ProviderEntry): OpenCodeAuthProvider {
  switch (entry.integrationId) {
    case "claude":
      return "claude"
    case "command-code":
      return "command-code"
    case "ollama":
      return "ollama"
    default:
      throw new TypeError("Unsupported connector integration")
  }
}

export type V2RefreshOptions = {
  readonly entries: readonly ProviderEntry[]
  readonly deps: ProviderEntryDeps
  readonly connection: V2ConnectionSource
  readonly catalog: V2Catalog
  readonly clock: Clock
  readonly logger: ConnectorLogger
  readonly health: HealthPolicy
  readonly snapshotTimeoutMs: number
  readonly catalogReloadMs: number
  readonly lifetime: AbortSignal
  readonly reloadProviders: () => Promise<void>
  readonly subscribe: (signal: AbortSignal) => AsyncIterable<{ readonly type: string }>
}

export type V2RefreshController = {
  readonly refresh: () => Promise<void>
  readonly disposeReload: () => Promise<void>
  readonly disposeAdapters: () => Promise<void>
  readonly finishWatch: () => Promise<void>
}

function isCatalogEvent(type: string): boolean {
  return catalogEvents.some((event) => event === type)
}

async function activeConnection(
  source: V2ConnectionSource,
  integrationId: string,
): Promise<PluginV2ConnectionInfo | undefined> {
  try {
    return await source.active(integrationId)
  } catch (error: unknown) {
    if (error instanceof PluginV2ClientError) return undefined
    if (error instanceof DOMException && error.name === "AbortError") return undefined
    throw error
  }
}

export function createV2RefreshController(options: V2RefreshOptions): V2RefreshController {
  const adapters = new Map<string, ProviderAdapter>()
  const healthStore: HealthStore = new Map()
  let pending = false
  let running: Promise<void> | undefined
  let applied = ""
  let watchError: unknown
  let drainFlight: Promise<void> | undefined
  const isShutdownCancellation = (error: unknown): boolean => {
    if (!options.lifetime.aborted) return false
    if (error instanceof OperationCancelledError) return true
    return error instanceof DOMException && error.name === "AbortError"
  }
  const retainRefreshFailure = (error: unknown): void => {
    if (isShutdownCancellation(error) || watchError !== undefined) return
    watchError = error
    options.logger.log("warn", "v2.catalog.refresh-failed", {
      name: error instanceof Error ? error.name : "unknown",
    })
  }
  const observeRefresh = (operation: Promise<void>): void => {
    void operation.then(() => undefined, retainRefreshFailure)
  }
  const drainRefresh = (): Promise<void> => {
    if (drainFlight !== undefined) return drainFlight
    const current = running
    if (current === undefined) return Promise.resolve()
    drainFlight = current
      .then(() => undefined, retainRefreshFailure)
      .finally(() => {
        drainFlight = undefined
      })
    return drainFlight
  }
  const capture = async (): Promise<void> => {
    if (options.lifetime.aborted) return
    const active: ProviderEntry[] = []
    for (const entry of options.entries) {
      if (options.lifetime.aborted) return
      const provider = authProvider(entry)
      const match = await options.deps.authStore.matchAuth(provider)
      if (match === null || !(await entry.isConnected(options.deps))) {
        options.catalog.forget(entry.id)
        healthStore.delete(parseProviderId(entry.id))
        const retired = adapters.get(entry.id)
        if (retired !== undefined) {
          adapters.delete(entry.id)
          await retired.dispose()
        }
        continue
      }
      if (!options.catalog.matchesConnection(entry.id, match)) {
        options.catalog.rotate(entry.id, match)
        healthStore.delete(parseProviderId(entry.id))
        const retired = adapters.get(entry.id)
        if (retired !== undefined) {
          adapters.delete(entry.id)
          await retired.dispose()
        }
      }
      options.catalog.rememberConnection(
        entry.id,
        await activeConnection(options.connection, entry.integrationId),
      )
      const existing = adapters.get(entry.id)
      if (existing === undefined) adapters.set(entry.id, entry.createAdapter(options.deps))
      const current = adapters.get(entry.id)
      if (current !== undefined) active.push(entry)
    }
    await refreshAdaptersWithHealth({
      adapters: active.flatMap((entry) => {
        const adapter = adapters.get(entry.id)
        return adapter === undefined ? [] : [adapter]
      }),
      publisher: {
        publish: async (snapshot, signal) => {
          const entry = active.find((candidate) => candidate.id === snapshot.providerId)
          if (
            entry === undefined ||
            !options.catalog.matchesConnection(
              entry.id,
              await options.deps.authStore.matchAuth(authProvider(entry)),
            )
          ) {
            throw new OperationCancelledError("connection-changed")
          }
          await options.catalog.publisher.publish(snapshot, signal)
        },
      },
      logger: options.logger,
      clock: options.clock,
      health: options.health,
      store: healthStore,
      signal: options.lifetime,
      snapshotTimeoutMs: options.snapshotTimeoutMs,
    })
    const signature = options.catalog.signature()
    if (signature === applied || options.lifetime.aborted) return
    applied = signature
    await options.reloadProviders()
  }
  const refresh = (): Promise<void> => {
    pending = true
    if (running !== undefined) return running
    running = (async (): Promise<void> => {
      while (pending && !options.lifetime.aborted) {
        pending = false
        await capture()
      }
    })().finally(() => {
      running = undefined
    })
    return running
  }
  const watching = (async (): Promise<void> => {
    try {
      for await (const event of options.subscribe(options.lifetime)) {
        if (options.lifetime.aborted) return
        if (isCatalogEvent(event.type)) observeRefresh(refresh())
      }
    } catch (error: unknown) {
      if (options.lifetime.aborted) return
      if (error instanceof DOMException && error.name === "AbortError") return
      if (error instanceof PluginV2ClientError) return
      if (watchError === undefined) watchError = error
      options.logger.log("warn", "v2.catalog.watch-failed", {
        name: error instanceof Error ? error.name : "unknown",
      })
    }
  })()
  const reload = scheduleCatalogReload({
    clock: options.clock,
    intervalMs: options.catalogReloadMs,
    reload: refresh,
  })
  return {
    refresh,
    disposeReload: () => reload.dispose(),
    disposeAdapters: async (): Promise<void> => {
      await drainRefresh()
      const results = await Promise.allSettled(
        [...adapters.values()].map((adapter) => Promise.resolve().then(() => adapter.dispose())),
      )
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )
      if (failure !== undefined) throw failure.reason
    },
    finishWatch: async (): Promise<void> => {
      await watching
      await drainRefresh()
      if (watchError !== undefined) throw watchError
    },
  }
}
