import { OperationCancelledError } from "../../core/errors"
import { OllamaCatalogError, type OllamaCatalogErrorKind } from "./errors"

export type OllamaFetch = (url: string, init?: RequestInit) => Promise<Response>
export type OllamaCatalogOperation = "cloud-family" | "cloud-search" | "local-tags"

const MAX_BODY_BYTES = 256 * 1024

export const productionOllamaFetch: OllamaFetch = (url, init) => fetch(url, init)

type CatalogRequest = {
  readonly url: string
  readonly accept: "application/json" | "text/html"
  readonly operation: OllamaCatalogOperation
  readonly fetch: OllamaFetch
  readonly signal: AbortSignal
}

function failureKind(status: number): OllamaCatalogErrorKind {
  return status >= 500 ? "transport-error" : "invalid-data"
}

async function readBoundedBody(
  response: Response,
  operation: OllamaCatalogOperation,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.byteLength
    if (length > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new OllamaCatalogError(operation, "invalid-data")
    }
    chunks.push(result.value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export async function requestOllamaCatalog(request: CatalogRequest): Promise<string> {
  if (request.signal.aborted) throw new OperationCancelledError(request.operation)
  let response: Response
  try {
    response = await request.fetch(request.url, {
      method: "GET",
      headers: { accept: request.accept },
      signal: request.signal,
      redirect: "error",
      credentials: "omit",
    })
  } catch (error) {
    if (request.signal.aborted) throw new OperationCancelledError(request.operation)
    if (error instanceof TypeError || error instanceof DOMException) {
      throw new OllamaCatalogError(request.operation, "transport-error")
    }
    throw error
  }
  if (!response.ok) {
    throw new OllamaCatalogError(request.operation, failureKind(response.status))
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await readBoundedBody(response, request.operation),
    )
  } catch (error) {
    if (request.signal.aborted) throw new OperationCancelledError(request.operation)
    if (error instanceof OllamaCatalogError) throw error
    if (error instanceof TypeError || error instanceof DOMException) {
      throw new OllamaCatalogError(request.operation, "invalid-data")
    }
    throw error
  }
}
