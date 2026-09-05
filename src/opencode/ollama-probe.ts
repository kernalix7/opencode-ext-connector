import { OperationCancelledError } from "../core/errors.js"
import { OllamaCatalogError } from "../providers/ollama/errors.js"
import type { OllamaFetch } from "../providers/ollama/http.js"
import { listLocalOllamaModels } from "../providers/ollama/local-catalog.js"

const OLLAMA_PROBE_TIMEOUT_MS = 5_000

export async function probeLocalOllama(fetch: OllamaFetch): Promise<boolean> {
  try {
    await listLocalOllamaModels(fetch, AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS))
    return true
  } catch (error) {
    if (error instanceof OllamaCatalogError || error instanceof OperationCancelledError)
      return false
    throw error
  }
}
