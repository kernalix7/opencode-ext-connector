import type { ClientHttp2Stream, IncomingHttpHeaders } from "node:http2"
import { createBrotliDecompress, createGunzip } from "node:zlib"

import { MAX_BRIDGE_BINARY_BYTES } from "./bridge-limits"

export type CursorH2ResponseCallbacks = {
  readonly onData: (chunk: Uint8Array) => boolean
  readonly onEnd: () => void
  readonly onError: (code: string, message: string) => void
}

export function bridgeResponseHeaders(
  headers: IncomingHttpHeaders,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith(":") || value === undefined) {
      continue
    }
    result[name] = Array.isArray(value) ? value.join(", ") : String(value)
  }
  return result
}

export function responseStatus(headers: IncomingHttpHeaders): number {
  const status = headers[":status"]
  return typeof status === "number" ? status : Number(status ?? 0)
}

export function attachCursorH2ResponseBody(
  request: ClientHttp2Stream,
  headers: IncomingHttpHeaders,
  callbacks: CursorH2ResponseCallbacks,
): void {
  const encoding = headers["content-encoding"]
  const source =
    encoding === "gzip"
      ? request.pipe(createGunzip())
      : encoding === "br"
        ? request.pipe(createBrotliDecompress())
        : request
  if (
    encoding !== undefined &&
    encoding !== "identity" &&
    encoding !== "gzip" &&
    encoding !== "br"
  ) {
    callbacks.onError("unsupported-content-encoding", "Cursor response encoding is unsupported")
    request.close()
    return
  }
  let outputBytes = 0
  source.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength
    if (outputBytes > MAX_BRIDGE_BINARY_BYTES) {
      callbacks.onError("decompressed-body-too-large", "Cursor response body exceeds the limit")
      source.destroy()
      request.close()
      return
    }
    if (!callbacks.onData(new Uint8Array(chunk))) {
      source.pause()
      process.stdout.once("drain", () => source.resume())
    }
  })
  source.on("error", () => {
    callbacks.onError("response-body-error", "Cursor response body could not be decoded")
    request.close()
  })
  source.once("end", callbacks.onEnd)
}
