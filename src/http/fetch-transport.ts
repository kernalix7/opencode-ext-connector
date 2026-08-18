import type { HttpRequest, HttpResponse, HttpTransport } from "../core/http"

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
        headers,
        body: new Uint8Array(await response.arrayBuffer()),
      }
    },
  }
}
