import type { ProviderAdapter } from "../core/adapter.js"
import type { HealthPolicy } from "../core/health.js"
import type { ConnectorLogger } from "../core/logger.js"
import { type HealthStore, refreshAdaptersWithHealth } from "./health-refresh.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import {
  type SubscriptionObservation,
  type SubscriptionScope,
  sameSubscription,
} from "./subscription-scope.js"
import {
  unavailableV1Model,
  type V1ApiProvider,
  type V1Binding,
  type V1ModelView,
} from "./v1-binding.js"
import type { V1CatalogProjector } from "./v1-catalog.js"

export type V1Generation = {
  readonly matches: (observation: SubscriptionObservation) => boolean
  readonly binding: V1Binding
  readonly refresh: () => Promise<void>
  readonly bind: (modelId: string) => V1ModelView
  readonly retire: () => Promise<void>
}

export function createV1Generation(options: {
  readonly entry: ProviderEntry
  readonly provider: V1ApiProvider
  readonly observation: SubscriptionObservation
  readonly scope: SubscriptionScope
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
  const readAccessToken = async (caller: AbortSignal): Promise<string | null> => {
    await options.observe(caller)
    const current =
      options.entry.route === "api"
        ? await options.deps.authStore
            .matchAuth(options.provider)
            .then((gate) =>
              gate?.kind === "api-key"
                ? { gate, token: gate.key, sourceIdentity: "selected-connection" }
                : null,
            )
        : await options.scope.observe(options.provider, caller)
    if (
      signal.aborted ||
      !options.isCurrent() ||
      current === null ||
      !sameSubscription(options.observation, current)
    )
      throw unavailableV1Model(options.entry.id)
    return current.token
  }
  const adapter: ProviderAdapter = options.entry.createAdapter({
    ...options.deps,
    allowEnvironmentKeys: false,
    readAccessToken,
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
    matches: (observation) => sameSubscription(options.observation, observation),
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
        env: options.deps.env,
        route: options.entry.route ?? "subscription",
        readApiKey: readAccessToken,
        readAccessToken: async (caller) => {
          await authorize(modelId, caller)
          return readAccessToken(caller)
        },
        forceRefreshAccessToken: async (caller) => {
          await authorize(modelId, caller)
          if (options.provider !== "claude") return null
          await options.scope.forceClaude(caller)
          return readAccessToken(caller)
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
