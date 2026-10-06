import type { ProviderAdapter } from "../core/adapter.js"
import type { HealthPolicy } from "../core/health.js"
import type { ConnectorLogger } from "../core/logger.js"
import { type HealthStore, refreshAdaptersWithHealth } from "./health-refresh.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import {
  unavailableV1Model,
  type V1ApiProvider,
  type V1Binding,
  type V1ModelView,
} from "./v1-binding.js"
import type { V1CatalogProjector } from "./v1-catalog.js"

export type V1Generation = {
  readonly key: string
  readonly binding: V1Binding
  readonly refresh: () => Promise<void>
  readonly bind: (modelId: string) => V1ModelView
  readonly retire: () => Promise<void>
}

export function createV1Generation(options: {
  readonly entry: ProviderEntry
  readonly provider: V1ApiProvider
  readonly key: string
  readonly binding: V1Binding
  readonly deps: ProviderEntryDeps
  readonly projector: V1CatalogProjector
  readonly health: HealthPolicy
  readonly logger: ConnectorLogger
  readonly snapshotTimeoutMs: number
  readonly lifetime: AbortSignal
  readonly observe: (signal: AbortSignal) => Promise<void>
  readonly isCurrent: () => boolean
}): V1Generation {
  const controller = new AbortController()
  const signal = AbortSignal.any([options.lifetime, controller.signal])
  const health: HealthStore = new Map()
  const membership = new Set<string>()
  const adapter: ProviderAdapter = options.entry.createAdapter({
    ...options.deps,
    allowEnvironmentKeys: false,
    authStore: {
      matchAuth: async (provider) =>
        provider === options.provider ? { kind: "api-key", key: options.key } : null,
    },
  })
  let disposal: Promise<void> | undefined
  const authorize = async (modelId: string, caller: AbortSignal): Promise<AbortSignal> => {
    if (caller.aborted || signal.aborted) throw unavailableV1Model(modelId)
    const combined = AbortSignal.any([caller, signal])
    await options.observe(combined)
    if (combined.aborted || !options.isCurrent() || !membership.has(modelId)) {
      throw unavailableV1Model(modelId)
    }
    return combined
  }
  return {
    key: options.key,
    binding: options.binding,
    refresh: () =>
      refreshAdaptersWithHealth({
        adapters: [adapter],
        publisher: {
          publish: async (snapshot, currentSignal) => {
            await options.observe(currentSignal)
            if (currentSignal.aborted || signal.aborted || !options.isCurrent()) return
            membership.clear()
            if (snapshot.status !== "unavailable") {
              for (const model of snapshot.models) membership.add(model.id)
            }
            await options.projector.publishBound(snapshot, options.binding, currentSignal)
          },
        },
        clock: options.deps.clock,
        logger: options.logger,
        health: options.health,
        store: health,
        signal,
        snapshotTimeoutMs: options.snapshotTimeoutMs,
      }),
    bind: (modelId) => {
      if (signal.aborted || !options.isCurrent() || !membership.has(modelId)) {
        throw unavailableV1Model(modelId)
      }
      return {
        signal,
        readApiKey: async (caller) => {
          await authorize(modelId, caller)
          return options.key
        },
        transport: {
          request: async (request, caller) => {
            const combined = await authorize(modelId, caller)
            return options.deps.transport.request(request, combined)
          },
          ...(options.deps.transport.stream === undefined
            ? {}
            : {
                stream: async (request, caller) => {
                  const combined = await authorize(modelId, caller)
                  const stream = options.deps.transport.stream
                  if (stream === undefined) throw unavailableV1Model(modelId)
                  return stream.call(options.deps.transport, request, combined)
                },
              }),
        },
      }
    },
    retire: () => {
      controller.abort()
      membership.clear()
      disposal ??= adapter.dispose()
      return disposal
    },
  }
}
