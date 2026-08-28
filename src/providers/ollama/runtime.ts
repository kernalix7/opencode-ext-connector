import { OperationCancelledError } from "../../core/errors"
import type { AdapterModel } from "../../core/models"
import type { OllamaCatalogState } from "./catalog-state"
import { OllamaGenerationError } from "./errors"
import { type OllamaFetch, productionOllamaFetch } from "./http"
import { listLocalOllamaModels } from "./local-catalog"
import { parseOllamaNdjson } from "./ndjson"
import { type OllamaChatRequest, OllamaPullChunkSchema } from "./protocol"

const PULL_URL = "http://localhost:11434/api/pull"
const CHAT_URL = "http://localhost:11434/api/chat"
const JSON_HEADERS = {
  accept: "application/x-ndjson",
  "content-type": "application/json",
} as const

export type OllamaRuntimeOptions = {
  readonly catalog: OllamaCatalogState
  readonly fetch?: OllamaFetch
}

export interface OllamaRuntime {
  openChat(request: OllamaChatRequest, signal: AbortSignal): Promise<Response>
}

function cancelled(operation: string): OperationCancelledError {
  return new OperationCancelledError(`ollama-${operation}`)
}

async function post(
  fetch: OllamaFetch,
  url: string,
  body: object,
  signal: AbortSignal,
  operation: "chat" | "pull",
): Promise<Response> {
  if (signal.aborted) throw cancelled(operation)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      signal,
      credentials: "omit",
      redirect: "error",
    })
    if (signal.aborted) throw cancelled(operation)
    if (!response.ok) throw new OllamaGenerationError(operation)
    return response
  } catch (error) {
    if (signal.aborted) throw cancelled(operation)
    if (error instanceof OperationCancelledError) throw error
    if (error instanceof OllamaGenerationError) throw error
    throw new OllamaGenerationError(operation)
  }
}

type PullFlight = {
  readonly controller: AbortController
  readonly promise: Promise<void>
  waiters: number
}

export function createOllamaRuntime(options: OllamaRuntimeOptions): OllamaRuntime {
  const fetch = options.fetch ?? productionOllamaFetch
  const pulls = new Map<string, PullFlight>()
  const pull = (modelId: string): PullFlight => {
    const existing = pulls.get(modelId)
    if (existing !== undefined) return existing
    const controller = new AbortController()
    const promise = (async (): Promise<void> => {
      const response = await post(
        fetch,
        PULL_URL,
        { model: modelId, stream: true },
        controller.signal,
        "pull",
      )
      let succeeded = false
      for await (const chunk of parseOllamaNdjson(
        response,
        OllamaPullChunkSchema,
        "pull-response",
      )) {
        if (chunk.error !== undefined) throw new OllamaGenerationError("pull-response")
        if (chunk.status === "success") succeeded = true
      }
      if (!succeeded) throw new OllamaGenerationError("pull-response")
    })()
    const flight: PullFlight = { controller, promise, waiters: 0 }
    pulls.set(modelId, flight)
    const settle = (): void => {
      if (pulls.get(modelId) === flight) pulls.delete(modelId)
    }
    promise.then(settle, settle)
    return flight
  }
  const waitForPull = (modelId: string, flight: PullFlight, signal: AbortSignal): Promise<void> => {
    flight.waiters += 1
    const deferred = Promise.withResolvers<void>()
    let settled = false
    const release = (): void => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      flight.waiters -= 1
      if (flight.waiters === 0 && pulls.get(modelId) === flight) {
        pulls.delete(modelId)
        flight.controller.abort(cancelled("pull"))
      }
    }
    const onAbort = (): void => {
      release()
      deferred.reject(cancelled("pull-wait"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
    flight.promise.then(
      () => {
        if (settled) return
        release()
        deferred.resolve()
      },
      (error: unknown) => {
        if (settled) return
        release()
        deferred.reject(error)
      },
    )
    return deferred.promise
  }
  return {
    openChat: async (request, signal) => {
      let local: readonly AdapterModel[]
      try {
        local = await listLocalOllamaModels(fetch, signal)
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error
        throw new OllamaGenerationError("tags")
      }
      if (!local.some(({ id }) => id === request.model)) {
        if (!options.catalog.authorizesCloudPull(request.model)) {
          throw new OllamaGenerationError("model-unavailable")
        }
        await waitForPull(request.model, pull(request.model), signal)
      }
      return post(fetch, CHAT_URL, request, signal, "chat")
    },
  }
}
