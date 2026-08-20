import type { HttpRequest, HttpResponse, HttpStreamResponse, HttpTransport } from "../core/http"

export function createFetchHttpTransport(): HttpTransport {
  return {
    request: async (request: HttpRequest, signal: AbortSignal): Promise<HttpResponse> => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
      })
      const headers: { [name: string]: string } = {}
      response.headers.forEach((value, name) => {
        headers[name] = value
      })
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: new Uint8Array(await response.arrayBuffer()),
        bodyPresent: response.body !== null,
      }
    },
    stream: async (request: HttpRequest, signal: AbortSignal): Promise<HttpStreamResponse> => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
      })
      const headers: { [name: string]: string } = {}
      response.headers.forEach((value, name) => {
        headers[name] = value
      })
      const body = response.body
      if (body === null) {
        return {
          status: response.status,
          statusText: response.statusText,
          headers,
          body: (async function* () {})(),
          bodyPresent: false,
        }
      }
      const reader = body.getReader()
      const streamBody = (async function* () {
        let completed = false
        try {
          while (true) {
            if (signal.aborted) {
              throw new DOMException("Aborted", "AbortError")
            }
            const { done, value } = await reader.read()
            if (done) {
              completed = true
              break
            }
            yield value
          }
        } finally {
          if (!completed) {
            await reader.cancel()
          }
          reader.releaseLock()
        }
      })()
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: streamBody,
        bodyPresent: true,
      }
    },
  }
}
