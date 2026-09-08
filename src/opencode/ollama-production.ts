import {
  createOllamaCatalogState,
  type OllamaCatalogState,
} from "../providers/ollama/catalog-state.js"
import { type OllamaEndpoints, parseOllamaEndpoints } from "../providers/ollama/endpoints.js"
import { productionOllamaFetch } from "../providers/ollama/http.js"
import { createOllamaRuntime, type OllamaRuntime } from "../providers/ollama/runtime.js"

export type ProductionOllamaBundle = {
  readonly endpoints: OllamaEndpoints
  readonly catalog: OllamaCatalogState
  readonly runtime: OllamaRuntime
}

const bundles = new Map<string, ProductionOllamaBundle>()

export function getProductionOllamaBundle(input?: unknown): ProductionOllamaBundle {
  const endpoints = parseOllamaEndpoints(input)
  const existing = bundles.get(endpoints.baseURL)
  if (existing !== undefined) return existing
  const catalog = createOllamaCatalogState({ fetch: productionOllamaFetch })
  const bundle = Object.freeze({
    endpoints,
    catalog,
    runtime: createOllamaRuntime({ endpoints, catalog, fetch: productionOllamaFetch }),
  })
  bundles.set(endpoints.baseURL, bundle)
  return bundle
}

const defaultBundle = getProductionOllamaBundle()
export const productionOllamaCatalog: OllamaCatalogState = defaultBundle.catalog
export const productionOllamaRuntime: OllamaRuntime = defaultBundle.runtime
