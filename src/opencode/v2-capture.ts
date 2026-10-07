import type { ProviderAdapter } from "../core/adapter.js"
import { OperationCancelledError } from "../core/errors.js"
import { parseProviderId } from "../core/ids.js"
import type { OpenCodeAuthProvider } from "./auth-store.js"
import { PluginV2ClientError, type PluginV2ConnectionInfo } from "./beta-api.js"
import { type HealthStore, refreshAdaptersWithHealth } from "./health-refresh.js"
import type { ProviderEntry } from "./provider-entry.js"
import type { V2ConnectionSource } from "./v2-auth.js"
import type { V2RefreshOptions } from "./v2-refresh-types.js"

function authProvider(entry: ProviderEntry): OpenCodeAuthProvider {
  switch (entry.id) {
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

export function createV2Capture(
  options: V2RefreshOptions,
  state: {
    readonly adapters: Map<string, ProviderAdapter>
    readonly healthStore: HealthStore
  },
): () => Promise<void> {
  const { adapters, healthStore } = state
  let applied = ""
  return async (): Promise<void> => {
    if (options.lifetime.aborted) return
    const active: ProviderEntry[] = []
    for (const entry of options.entries) {
      if (options.lifetime.aborted) return
      const provider = authProvider(entry)
      const observation =
        provider === "ollama" ? null : await options.scope.observe(provider, options.lifetime)
      const match =
        provider === "ollama"
          ? await options.deps.authStore.matchAuth(provider)
          : (observation?.gate ?? null)
      if (match === null || (provider === "ollama" && !(await entry.isConnected(options.deps)))) {
        options.catalog.forget(entry.id)
        healthStore.delete(parseProviderId(entry.id))
        const retired = adapters.get(entry.id)
        if (retired !== undefined) {
          adapters.delete(entry.id)
          await retired.dispose()
        }
        continue
      }
      if (
        !options.catalog.matchesConnection(entry.id, match) &&
        (observation === null || !options.catalog.matchesSource(entry.id, observation))
      ) {
        options.catalog.rotate(entry.id, match)
        healthStore.delete(parseProviderId(entry.id))
        const retired = adapters.get(entry.id)
        if (retired !== undefined) {
          adapters.delete(entry.id)
          await retired.dispose()
        }
      }
      if (observation !== null && !options.catalog.matchesSource(entry.id, observation)) {
        const retired = adapters.get(entry.id)
        if (retired !== undefined) {
          adapters.delete(entry.id)
          await retired.dispose()
        }
        healthStore.delete(parseProviderId(entry.id))
        options.catalog.observeSource(entry.id, observation)
      }
      const selected = await activeConnection(options.connection, entry.integrationId)
      const selectedId = selected?.type === "credential" ? selected.id : selected?.name
      if (
        selected === undefined ||
        selected.status !== undefined ||
        selectedId !== match.connectionId
      ) {
        options.catalog.forget(entry.id)
        healthStore.delete(parseProviderId(entry.id))
        const retired = adapters.get(entry.id)
        if (retired !== undefined) {
          adapters.delete(entry.id)
          await retired.dispose()
        }
        continue
      }
      options.catalog.rememberConnection(entry.id, selected)
      const existing = adapters.get(entry.id)
      if (existing === undefined)
        adapters.set(
          entry.id,
          entry.createAdapter({
            ...options.deps,
            readAccessToken: async (signal) => {
              const current = await options.scope.observe(provider, signal)
              return options.catalog.matchesSource(entry.id, current)
                ? (current?.token ?? null)
                : null
            },
          }),
        )
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
            (entry.id === "ollama"
              ? !options.catalog.matchesConnection(
                  entry.id,
                  await options.deps.authStore.matchAuth("ollama"),
                )
              : !options.catalog.matchesSource(
                  entry.id,
                  await options.scope.observe(authProvider(entry), signal),
                ))
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
}
