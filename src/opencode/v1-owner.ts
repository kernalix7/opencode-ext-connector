import type { HealthPolicy } from "../core/health.js"
import { createAsyncDisposable } from "../core/lifecycle.js"
import type { ConnectorLogger } from "../core/logger.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import { readProviderApiKey } from "./providers.js"
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
  const generations = new Map<V1ApiProvider, V1Generation>()
  const observations = new Map<V1ApiProvider, Promise<V1Generation | undefined>>()
  const pendingDisposals = new Set<Promise<void>>()
  const disposalErrors: unknown[] = []
  let disposed = false
  let refreshing: Promise<void> | undefined
  const entries = options.entries.flatMap((entry) => {
    if (entry.id !== "claude" && entry.id !== "command-code") return []
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
      if (disposed || options.lifetime.aborted) return undefined
      let key: string | null
      try {
        key = await readProviderApiKey(options.deps, provider, caller)
      } catch (error: unknown) {
        retire(provider)
        throw error
      }
      if (disposed || options.lifetime.aborted) return undefined
      const previous = generations.get(provider)
      if (key !== null && previous?.key === key) return previous
      retire(provider)
      if (key === null) return undefined
      const entry = entries.find((candidate) => candidate.provider === provider)?.entry
      if (entry === undefined) return undefined
      const generation: V1Generation = createV1Generation({
        entry,
        provider,
        key,
        binding: newV1Binding(id),
        deps: options.deps,
        projector: options.projector,
        health: options.health,
        logger: options.logger,
        snapshotTimeoutMs: options.snapshotTimeoutMs,
        lifetime: options.lifetime,
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
    if (refreshing !== undefined) await refreshing
    await Promise.allSettled([...pendingDisposals])
    if (disposalErrors.length > 0)
      throw new AggregateError(disposalErrors, "V1 adapter cleanup failed")
  })
  return {
    refresh: () => {
      refreshing ??= (async () => {
        for (const { provider } of entries) {
          const generation = await observe(provider, options.lifetime)
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
        unregisterV1Owner(id)
        for (const { provider } of entries) retire(provider)
      }
      return cleanup.dispose()
    },
  }
}
