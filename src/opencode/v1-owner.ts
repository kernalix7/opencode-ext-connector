import { OperationCancelledError } from "../core/errors.js"
import type { HealthPolicy } from "../core/health.js"
import { parseProviderId } from "../core/ids.js"
import { createAsyncDisposable } from "../core/lifecycle.js"
import type { ConnectorLogger } from "../core/logger.js"
import { type HealthStore, recordCredentialFailure } from "./health-refresh.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import type { SubscriptionObservation } from "./subscription-scope.js"
import { createSubscriptionScope } from "./subscription-scope.js"
import {
  newV1Binding,
  newV1OwnerId,
  registerV1Owner,
  unavailableV1Model,
  unregisterV1Owner,
  type V1ApiProvider,
} from "./v1-binding.js"
import type { V1CatalogProjector } from "./v1-catalog.js"
import { createV1Generation, type V1Generation } from "./v1-generation.js"

export type V1Owner = {
  readonly refresh: () => Promise<void>
  readonly dispose: () => Promise<void>
}

export function createV1Owner(options: {
  readonly entries: readonly ProviderEntry[]
  readonly deps: ProviderEntryDeps
  readonly projector: V1CatalogProjector
  readonly health: HealthPolicy
  readonly logger: ConnectorLogger
  readonly snapshotTimeoutMs: number
  readonly lifetime: AbortSignal
}): V1Owner {
  const id = newV1OwnerId()
  const controller = new AbortController()
  const lifetime = AbortSignal.any([options.lifetime, controller.signal])
  const scope = createSubscriptionScope(options.deps)
  const generations = new Map<V1ApiProvider, V1Generation>()
  const observations = new Map<V1ApiProvider, Promise<V1Generation | undefined>>()
  const pendingDisposals = new Set<Promise<void>>()
  const credentialHealth: HealthStore = new Map()
  const disposalErrors: unknown[] = []
  let disposed = false
  let refreshing: Promise<void> | undefined
  let scopeDisposal: Promise<void> | undefined
  const entries = options.entries.flatMap((entry) => {
    if ((entry.id !== "claude" && entry.id !== "command-code") || entry.route === undefined)
      return []
    return [
      { entry, provider: entry.id } satisfies {
        readonly entry: ProviderEntry
        readonly provider: V1ApiProvider
      },
    ]
  })
  const retire = (provider: V1ApiProvider): void => {
    const generation = generations.get(provider)
    if (generation === undefined) return
    generations.delete(provider)
    options.projector.remove(provider)
    const pending = generation.retire()
    pendingDisposals.add(pending)
    void pending.then(
      () => pendingDisposals.delete(pending),
      (error: unknown) => {
        pendingDisposals.delete(pending)
        disposalErrors.push(error)
      },
    )
  }
  const observe = (
    provider: V1ApiProvider,
    caller: AbortSignal,
  ): Promise<V1Generation | undefined> => {
    const current = observations.get(provider)
    if (current !== undefined) return current
    const observation = (async (): Promise<V1Generation | undefined> => {
      if (disposed || lifetime.aborted) return undefined
      let observation: Awaited<ReturnType<typeof scope.observe>>
      try {
        const entry = entries.find((candidate) => candidate.provider === provider)?.entry
        if (entry?.route === "api") {
          const gate = await options.deps.authStore.matchAuth(provider)
          observation =
            gate?.kind === "api-key"
              ? ({
                  gate,
                  token: gate.key,
                  sourceIdentity: "selected-connection",
                } satisfies SubscriptionObservation)
              : null
        } else {
          const current = credentialHealth.get(parseProviderId(provider))
          if (
            current?.retryAtMs !== null &&
            current?.retryAtMs !== undefined &&
            options.deps.clock.nowMs() < current.retryAtMs
          )
            return undefined
          try {
            observation = await scope.observe(provider, caller)
            credentialHealth.delete(parseProviderId(provider))
          } catch (error: unknown) {
            if (
              caller.aborted ||
              lifetime.aborted ||
              error instanceof OperationCancelledError ||
              (error instanceof DOMException && error.name === "AbortError")
            )
              throw error
            retire(provider)
            recordCredentialFailure({
              providerId: parseProviderId(provider),
              error,
              clock: options.deps.clock,
              health: options.health,
              store: credentialHealth,
              logger: options.logger,
            })
            return undefined
          }
        }
      } catch (error: unknown) {
        retire(provider)
        throw error
      }
      if (disposed || lifetime.aborted) return undefined
      const previous = generations.get(provider)
      if (observation !== null && previous?.matches(observation)) return previous
      retire(provider)
      if (observation === null) return undefined
      const entry = entries.find((candidate) => candidate.provider === provider)?.entry
      if (entry === undefined) return undefined
      const generation: V1Generation = createV1Generation({
        entry,
        provider,
        observation,
        scope,
        binding: newV1Binding(id),
        deps: options.deps,
        projector: options.projector,
        health: options.health,
        logger: options.logger,
        snapshotTimeoutMs: options.snapshotTimeoutMs,
        lifetime,
        observe: async (signal) => {
          await observe(provider, signal)
        },
        isCurrent: () => !disposed && generations.get(provider) === generation,
      })
      generations.set(provider, generation)
      return generation
    })().finally(() => observations.delete(provider))
    observations.set(provider, observation)
    return observation
  }
  registerV1Owner({
    id,
    bind: (providerId, modelId, binding) => {
      if (disposed || (providerId !== "claude" && providerId !== "command-code")) {
        throw unavailableV1Model(modelId)
      }
      const generation = generations.get(providerId)
      if (generation === undefined || generation.binding.generation !== binding.generation) {
        throw unavailableV1Model(modelId)
      }
      return generation.bind(modelId)
    },
  })
  const cleanup = createAsyncDisposable(async () => {
    const results = await Promise.allSettled([refreshing, scopeDisposal, ...pendingDisposals])
    for (const result of results) {
      if (result.status !== "rejected") continue
      const error: unknown = result.reason
      if (
        error instanceof OperationCancelledError ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        continue
      if (!disposalErrors.includes(error)) disposalErrors.push(error)
    }
    observations.clear()
    if (disposalErrors.length > 0)
      throw new AggregateError(disposalErrors, "V1 adapter cleanup failed")
  })
  return {
    refresh: () => {
      if (disposed || lifetime.aborted) return Promise.resolve()
      refreshing ??= (async () => {
        for (const { provider } of entries) {
          const generation = await observe(provider, lifetime)
          if (generation !== undefined && !disposed) await generation.refresh()
        }
      })().finally(() => {
        refreshing = undefined
      })
      return refreshing
    },
    dispose: () => {
      if (!disposed) {
        disposed = true
        controller.abort()
        scopeDisposal = scope.dispose()
        unregisterV1Owner(id)
        for (const { provider } of entries) retire(provider)
      }
      return cleanup.dispose()
    },
  }
}
