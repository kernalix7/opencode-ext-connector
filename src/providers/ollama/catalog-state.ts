import { OperationCancelledError, ResourceDisposedError } from "../../core/errors.js"
import type { AsyncDisposableHandle } from "../../core/lifecycle.js"
import { createAsyncDisposable } from "../../core/lifecycle.js"
import type { AdapterModel } from "../../core/models.js"
import { discoverOllamaCloudReferences } from "./cloud-catalog.js"
import type { OllamaCloudReference } from "./cloud-reference.js"
import { type OllamaFetch, productionOllamaFetch } from "./http.js"

export interface OllamaCatalogLease extends AsyncDisposableHandle {
  refresh(signal: AbortSignal): Promise<readonly AdapterModel[]>
  models(): readonly AdapterModel[]
}

export interface OllamaCatalogState {
  acquire(): OllamaCatalogLease
  activeLeaseCount(): number
  authorizesCloudPull(modelId: string): boolean
  cloudPullAuthorization(modelId: string): OllamaCloudPullAuthorization | null
}

export type OllamaCloudPullAuthorization = {
  readonly reference: OllamaCloudReference
  readonly isCurrent: () => boolean
}

export type OllamaCatalogStateOptions = {
  readonly fetch?: OllamaFetch
  readonly familyConcurrency?: number
}

export function createOllamaCatalogState(
  options: OllamaCatalogStateOptions = {},
): OllamaCatalogState {
  const fetch = options.fetch ?? productionOllamaFetch
  const concurrency = options.familyConcurrency ?? 4
  let completeModels: readonly AdapterModel[] | null = null
  let references = new Map<string, OllamaCloudReference>()
  let activeLeases = 0
  return {
    acquire: (): OllamaCatalogLease => {
      activeLeases += 1
      let released = false
      const disposal = createAsyncDisposable(() => {
        released = true
        activeLeases -= 1
        if (activeLeases === 0) {
          completeModels = null
          references = new Map<string, OllamaCloudReference>()
        }
      })
      return {
        refresh: async (signal) => {
          if (released) throw new ResourceDisposedError("ollama-catalog-lease")
          const discovered = await discoverOllamaCloudReferences(fetch, signal, concurrency)
          if (released) throw new ResourceDisposedError("ollama-catalog-lease")
          if (signal.aborted) throw new OperationCancelledError("ollama-catalog-refresh")
          completeModels = discovered.map(({ model }) => model)
          references = new Map(discovered.map((reference) => [reference.model.id, reference]))
          return completeModels
        },
        models: () => completeModels ?? [],
        dispose: disposal.dispose,
        [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
      }
    },
    activeLeaseCount: () => activeLeases,
    authorizesCloudPull: (modelId) => activeLeases > 0 && references.has(modelId),
    cloudPullAuthorization: (modelId) => {
      const reference = references.get(modelId)
      if (activeLeases === 0 || reference === undefined) return null
      return {
        reference,
        isCurrent: () => activeLeases > 0 && references.get(modelId) === reference,
      }
    },
  }
}
