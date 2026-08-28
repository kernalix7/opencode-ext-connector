import { OperationCancelledError } from "../core/errors"
import { OllamaCatalogError } from "../providers/ollama/errors"
import type { OllamaFetch } from "../providers/ollama/http"
import { listLocalOllamaModels } from "../providers/ollama/local-catalog"

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
