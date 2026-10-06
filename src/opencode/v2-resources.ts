import type { Clock } from "../core/clock.js"
import type { ConnectorLogger } from "../core/logger.js"
import { createConsoleLogger } from "../logging/logger.js"
import {
  createOllamaCatalogState,
  type OllamaCatalogState,
} from "../providers/ollama/catalog-state.js"
import { type OllamaEndpoints, parseOllamaEndpoints } from "../providers/ollama/endpoints.js"
import { type OllamaFetch, productionOllamaFetch } from "../providers/ollama/http.js"
import { createOllamaRuntime, type OllamaRuntime } from "../providers/ollama/runtime.js"
import { getProductionOllamaBundle } from "./ollama-production.js"

export type V2OllamaBundle = {
  readonly endpoints: OllamaEndpoints
  readonly catalog: OllamaCatalogState
  readonly runtime: OllamaRuntime
  readonly fetch: OllamaFetch
}

export function createProductionClock(): Clock {
  return {
    nowMs: () => Date.now(),
    schedule: (delayMs, callback) => {
      const handle = setTimeout(callback, delayMs)
      handle.unref()
      const cancel = (): void => clearTimeout(handle)
      return { cancel, [Symbol.dispose]: cancel }
    },
  }
}

export function resolveV2OllamaBundle(
  baseURL: unknown,
  fetchImpl: OllamaFetch | undefined,
): V2OllamaBundle {
  if (fetchImpl === undefined) {
    const bundle = getProductionOllamaBundle(baseURL)
    return { ...bundle, fetch: productionOllamaFetch }
  }
  const endpoints = parseOllamaEndpoints(baseURL)
  const catalog = createOllamaCatalogState({ fetch: fetchImpl })
  return {
    endpoints,
    catalog,
    fetch: fetchImpl,
    runtime: createOllamaRuntime({ endpoints, catalog, fetch: fetchImpl }),
  }
}

export function createV2Logger(clock: Clock): ConnectorLogger {
  return createConsoleLogger(clock)
}
