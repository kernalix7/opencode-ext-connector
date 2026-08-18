import {
  HttpTransportError,
  InvalidArgumentError,
  OperationCancelledError,
} from "../../src/core/errors"
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/core/http"

export interface PendingHttpResponse {
  resolve(response: HttpResponse): void
  reject(error: Error): void
}

type HttpScript =
  | { readonly kind: "response"; readonly response: HttpResponse }
  | { readonly kind: "error"; readonly error: Error }
  | { readonly kind: "pending"; readonly promise: Promise<HttpResponse> }

function cloneHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(headers))
}

function cloneResponse(response: HttpResponse): HttpResponse {
  return {
    status: response.status,
    headers: cloneHeaders(response.headers),
    body: new Uint8Array(response.body),
  }
}

function cloneRequest(request: HttpRequest): HttpRequest {
  return {
    method: request.method,
    url: request.url,
    headers: cloneHeaders(request.headers),
    body: request.body === null ? null : new Uint8Array(request.body),
  }
}

function awaitWithSignal(
  promise: Promise<HttpResponse>,
  signal: AbortSignal,
): Promise<HttpResponse> {
  const deferred = Promise.withResolvers<HttpResponse>()
  const onAbort = (): void => deferred.reject(new OperationCancelledError("http-request"))
  signal.addEventListener("abort", onAbort, { once: true })
  promise.then(
    (response) => {
      signal.removeEventListener("abort", onAbort)
      deferred.resolve(cloneResponse(response))
    },
    (error: unknown) => {
      signal.removeEventListener("abort", onAbort)
      deferred.reject(error)
    },
  )
  return deferred.promise
}

export class FakeHttpTransport implements HttpTransport {
  public readonly requests: HttpRequest[] = []
  private readonly scripts: HttpScript[] = []

  public enqueueResponse(response: HttpResponse): void {
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new InvalidArgumentError("response.status")
    }
    this.scripts.push({ kind: "response", response: cloneResponse(response) })
  }
  public enqueueError(error: Error): void {
    this.scripts.push({ kind: "error", error })
  }
  public enqueuePending(): PendingHttpResponse {
    const deferred = Promise.withResolvers<HttpResponse>()
    this.scripts.push({ kind: "pending", promise: deferred.promise })
    return { resolve: deferred.resolve, reject: deferred.reject }
  }
  public async request(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
    if (signal.aborted) {
      throw new OperationCancelledError("http-request")
    }
    const script = this.scripts.shift()
    if (script === undefined) {
      throw new HttpTransportError({
        operation: "unexpected-request",
        retryable: false,
        cause: null,
      })
    }
    this.requests.push(cloneRequest(request))
    switch (script.kind) {
      case "response":
        return cloneResponse(script.response)
      case "error":
        throw script.error
      case "pending":
        return awaitWithSignal(script.promise, signal)
    }
  }
}
