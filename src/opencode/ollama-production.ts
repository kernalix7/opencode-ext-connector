import {
  createOllamaCatalogState,
  type OllamaCatalogState,
} from "../providers/ollama/catalog-state.js"
import { productionOllamaFetch } from "../providers/ollama/http.js"
import { createOllamaRuntime, type OllamaRuntime } from "../providers/ollama/runtime.js"

export const productionOllamaCatalog: OllamaCatalogState = createOllamaCatalogState({
  fetch: productionOllamaFetch,
})
export const productionOllamaRuntime: OllamaRuntime = createOllamaRuntime({
  catalog: productionOllamaCatalog,
  fetch: productionOllamaFetch,
})
