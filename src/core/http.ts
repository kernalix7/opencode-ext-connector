export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type HttpHeaders = { readonly [name: string]: string }

export type HttpRequest = {
  readonly method: HttpMethod
  readonly url: string
  readonly headers: HttpHeaders
  readonly body: Uint8Array | null
}

export type HttpResponse = {
  readonly status: number
  readonly statusText?: string
  readonly headers: HttpHeaders
  readonly body: Uint8Array
  readonly bodyPresent?: boolean
}

export type HttpStreamResponse = {
  readonly status: number
  readonly statusText?: string
  readonly headers: HttpHeaders
  readonly body: AsyncIterable<Uint8Array>
  readonly bodyPresent?: boolean
}

export interface HttpTransport {
  request(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse>
  stream?(request: HttpRequest, signal: AbortSignal): Promise<HttpStreamResponse>
}
