import type { HttpHeaders, HttpMethod, HttpTransport } from "../core/http.js"
import { openHttpBody } from "./read-body.js"

function sdkRequest(input: string | URL | Request, init: RequestInit | undefined): Request {
  if (input instanceof Request) return new Request(input, { ...init, redirect: "error" })
  return new Request(String(input), { ...init, redirect: "error" })
}

function requestHeaders(headers: Headers): HttpHeaders {
  const result: Record<string, string> = {}
  headers.forEach((value, name) => {
    result[name] = value
  })
  return result
}

function requestMethod(method: string): HttpMethod {
  switch (method) {
    case "GET":
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
      return method
    default:
      throw new TypeError("Unsupported SDK HTTP method")
  }
}

function responseBody(
  chunks: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      if (signal.aborted) {
        controller.error(signal.reason)
        await iterator.return?.()
        return
      }
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error: unknown) {
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}

export function createSdkFetch(transport: HttpTransport): typeof globalThis.fetch {
  const sdkFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = sdkRequest(input, init)
    const method = requestMethod(request.method)
    const headers = requestHeaders(request.headers)
    const body = request.body === null ? null : new Uint8Array(await request.arrayBuffer())
    const signal = request.signal
    const reply = await openHttpBody(transport, { method, url: request.url, headers, body }, signal)
    if (reply.status >= 300 && reply.status < 400) {
      throw new TypeError("SDK redirects are disabled")
    }
    const hasBody =
      reply.bodyPresent && reply.status !== 204 && reply.status !== 205 && reply.status !== 304
    return new Response(hasBody ? responseBody(reply.chunks, signal) : null, {
      status: reply.status,
      ...(reply.statusText === undefined ? {} : { statusText: reply.statusText }),
      headers: reply.headers,
    })
  }
  return Object.assign(sdkFetch, { preconnect: globalThis.fetch.preconnect })
}
