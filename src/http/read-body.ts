import type { HttpHeaders, HttpRequest, HttpTransport } from "../core/http"

export type HttpBodyStream = {
  readonly status: number
  readonly statusText?: string
  readonly headers: HttpHeaders
  readonly chunks: AsyncIterable<Uint8Array>
  readonly bodyPresent: boolean
}

export async function openHttpBody(
  transport: HttpTransport,
  request: HttpRequest,
  signal: AbortSignal,
): Promise<HttpBodyStream> {
  if (transport.stream !== undefined) {
    const streamed = await transport.stream(request, signal)
    return {
      status: streamed.status,
      ...(streamed.statusText === undefined ? {} : { statusText: streamed.statusText }),
      headers: streamed.headers,
      chunks: streamed.body,
      bodyPresent: streamed.bodyPresent ?? true,
    }
  }
  const response = await transport.request(request, signal)
  return {
    status: response.status,
    ...(response.statusText === undefined ? {} : { statusText: response.statusText }),
    headers: response.headers,
    chunks: (async function* () {
      yield response.body
    })(),
    bodyPresent: response.bodyPresent ?? true,
  }
}
