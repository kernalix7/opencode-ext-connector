import { ResourceDisposedError } from "../../core/errors"
import type { AsyncDisposableHandle } from "../../core/lifecycle"
import { createAsyncDisposable } from "../../core/lifecycle"
import type { AdapterModel } from "../../core/models"
import { discoverOllamaCloudModels } from "./cloud-catalog"
import { type OllamaFetch, productionOllamaFetch } from "./http"

export interface OllamaCatalogLease extends AsyncDisposableHandle {
  refresh(signal: AbortSignal): Promise<readonly AdapterModel[]>
  models(): readonly AdapterModel[]
}

export interface OllamaCatalogState {
  acquire(): OllamaCatalogLease
  activeLeaseCount(): number
  authorizesCloudPull(modelId: string): boolean
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
  let authorizedIds = new Set<string>()
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
          authorizedIds = new Set<string>()
        }
      })
      return {
        refresh: async (signal) => {
          if (released) throw new ResourceDisposedError("ollama-catalog-lease")
          const discovered = await discoverOllamaCloudModels(fetch, signal, concurrency)
          completeModels = discovered
          authorizedIds = new Set(discovered.map(({ id }) => id))
          return discovered
        },
        models: () => completeModels ?? [],
        dispose: disposal.dispose,
        [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
      }
    },
    activeLeaseCount: () => activeLeases,
    authorizesCloudPull: (modelId) => activeLeases > 0 && authorizedIds.has(modelId),
  }
}
