import {
  createOllamaCatalogState,
  type OllamaCatalogState,
} from "../providers/ollama/catalog-state"
import { productionOllamaFetch } from "../providers/ollama/http"
import { createOllamaRuntime, type OllamaRuntime } from "../providers/ollama/runtime"

export const productionOllamaCatalog: OllamaCatalogState = createOllamaCatalogState({
  fetch: productionOllamaFetch,
})
export const productionOllamaRuntime: OllamaRuntime = createOllamaRuntime({
  catalog: productionOllamaCatalog,
  fetch: productionOllamaFetch,
})
