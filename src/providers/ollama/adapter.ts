import type { ProviderAdapter } from "../../core/adapter.js"
import { OperationCancelledError } from "../../core/errors.js"
import type { ModelId } from "../../core/ids.js"
import { parseProviderId } from "../../core/ids.js"
import { createAsyncDisposable } from "../../core/lifecycle.js"
import type { AdapterModel, ProviderSnapshot } from "../../core/models.js"
import type { OllamaCatalogState } from "./catalog-state.js"
import { OllamaCatalogError } from "./errors.js"
import type { OllamaFetch } from "./http.js"
import { listLocalOllamaModels } from "./local-catalog.js"

export type OllamaAdapterOptions = {
  readonly fetch: OllamaFetch
  readonly catalog: OllamaCatalogState
}

function mergeModels(
  local: readonly AdapterModel[],
  cloud: readonly AdapterModel[],
): readonly AdapterModel[] {
  const ids = new Set<ModelId>()
  const merged: AdapterModel[] = []
  for (const model of [...local, ...cloud]) {
    if (ids.has(model.id)) continue
    ids.add(model.id)
    merged.push(model)
  }
  return merged
}

function catalogFailure(error: unknown): OllamaCatalogError {
  if (error instanceof OperationCancelledError) throw error
  if (error instanceof OllamaCatalogError) return error
  throw error
}

export function createOllamaAdapter(options: OllamaAdapterOptions): ProviderAdapter {
  const providerId = parseProviderId("ollama")
  const lease = options.catalog.acquire()
  const disposal = createAsyncDisposable(() => lease.dispose())
  let lastMergedModels: readonly AdapterModel[] | null = null
  return {
    providerId,
    snapshot: async (signal): Promise<ProviderSnapshot> => {
      if (signal.aborted) throw new OperationCancelledError("ollama-snapshot")
      let local: readonly AdapterModel[]
      try {
        local = await listLocalOllamaModels(options.fetch, signal)
      } catch (error) {
        const failure = catalogFailure(error)
        return lastMergedModels === null
          ? { status: "unavailable", providerId, reason: failure.kind }
          : { status: "stale", providerId, models: lastMergedModels, reason: failure.kind }
      }
      try {
        const models = mergeModels(local, await lease.refresh(signal))
        lastMergedModels = models
        return { status: "ready", providerId, models }
      } catch (error) {
        const failure = catalogFailure(error)
        const previousCloud = lease.models()
        if (previousCloud.length === 0) {
          return lastMergedModels === null
            ? { status: "unavailable", providerId, reason: failure.kind }
            : { status: "stale", providerId, models: lastMergedModels, reason: failure.kind }
        }
        const models = mergeModels(local, previousCloud)
        lastMergedModels = models
        return { status: "stale", providerId, models, reason: failure.kind }
      }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
