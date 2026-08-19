import type { HttpHeaders, HttpRequest, HttpTransport } from "../core/http"

export type HttpBodyStream = {
  readonly status: number
  readonly headers: HttpHeaders
  readonly chunks: AsyncIterable<Uint8Array>
}

export async function openHttpBody(
  transport: HttpTransport,
  request: HttpRequest,
  signal: AbortSignal,
): Promise<HttpBodyStream> {
  if (transport.stream !== undefined) {
    const streamed = await transport.stream(request, signal)
    return { status: streamed.status, headers: streamed.headers, chunks: streamed.body }
  }
  const response = await transport.request(request, signal)
  return {
    status: response.status,
    headers: response.headers,
    chunks: (async function* () {
      yield response.body
    })(),
  }
}
