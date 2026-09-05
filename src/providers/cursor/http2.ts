import http2 from "node:http2"

import { OperationCancelledError } from "../../core/errors.js"

export const CURSOR_API_URL = "https://api2.cursor.sh"
export const CURSOR_CLIENT_VERSION = "cli-2026.08.11-e8db854"

export type CursorHttp2Post = {
  readonly path: string
  readonly token: string
  readonly body: Uint8Array
  readonly headers: Readonly<Record<string, string>>
  readonly signal: AbortSignal
  readonly keepOpen?: boolean
  readonly heartbeat?: Uint8Array
  readonly onWriter?: (write: (frame: Uint8Array) => void) => void
}

export type CursorHttp2Response = {
  readonly status: number
  readonly body: Uint8Array
}

export async function cursorHttp2Post(request: CursorHttp2Post): Promise<CursorHttp2Response> {
  if (request.signal.aborted) {
    throw new OperationCancelledError("cursor-http2")
  }
  const client = http2.connect(CURSOR_API_URL)
  try {
    return await new Promise<CursorHttp2Response>((resolve, reject) => {
      const fail = (error: Error): void => {
        reject(error)
      }
      const onAbort = (): void => {
        fail(new OperationCancelledError("cursor-http2"))
      }
      request.signal.addEventListener("abort", onAbort, { once: true })
      const req = client.request(requestHeaders(request))
      const chunks: Buffer[] = []
      let status = 0
      req.on("response", (headers) => {
        const raw = headers[":status"]
        status = typeof raw === "number" ? raw : Number(raw ?? 0)
      })
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
      })
      req.on("end", () => {
        request.signal.removeEventListener("abort", onAbort)
        resolve({ status, body: new Uint8Array(Buffer.concat(chunks)) })
      })
      req.on("error", (error: Error) => {
        request.signal.removeEventListener("abort", onAbort)
        fail(error)
      })
      writeHttp2Body(req, request.body, true)
    })
  } finally {
    client.close()
  }
}

function toBuffer(body: Uint8Array): Buffer {
  const payload = Buffer.alloc(body.length)
  payload.set(body)
  return payload
}

function writeHttp2Body(req: http2.ClientHttp2Stream, body: Uint8Array, endStream: boolean): void {
  if (body.length === 0) {
    if (endStream) {
      req.end()
    }
    return
  }
  if (endStream) {
    req.end(toBuffer(body))
    return
  }
  req.write(toBuffer(body))
}

function requestHeaders(request: CursorHttp2Post): http2.OutgoingHttpHeaders {
  return {
    ":method": "POST",
    ":path": request.path,
    authorization: `Bearer ${request.token}`,
    "x-ghost-mode": "true",
    "x-cursor-client-version": CURSOR_CLIENT_VERSION,
    "x-cursor-client-type": "cli",
    ...request.headers,
  }
}

export async function* cursorHttp2Stream(request: CursorHttp2Post): AsyncIterable<Uint8Array> {
  if (request.signal.aborted) {
    throw new OperationCancelledError("cursor-http2")
  }
  const client = http2.connect(CURSOR_API_URL)
  const pending: (Uint8Array | Error | null)[] = []
  let resume: (() => void) | null = null
  const push = (item: Uint8Array | Error | null): void => {
    pending.push(item)
    resume?.()
  }
  const onAbort = (): void => {
    push(new OperationCancelledError("cursor-http2"))
  }
  request.signal.addEventListener("abort", onAbort, { once: true })
  try {
    const req = client.request(requestHeaders(request))
    req.on("data", (chunk: Buffer) => {
      push(new Uint8Array(chunk))
    })
    req.on("end", () => {
      push(null)
    })
    req.on("error", (error: Error) => {
      push(error)
    })
    request.onWriter?.((frame) => {
      if (!req.destroyed) {
        req.write(toBuffer(frame))
      }
    })
    writeHttp2Body(req, request.body, request.keepOpen !== true)
    const heartbeat = request.heartbeat
    if (request.keepOpen === true && heartbeat !== undefined && heartbeat.length > 0) {
      req.write(toBuffer(heartbeat))
    }
    const timer =
      request.keepOpen === true && heartbeat !== undefined && heartbeat.length > 0
        ? setInterval(() => {
            if (!req.destroyed) {
              req.write(toBuffer(heartbeat))
            }
          }, 5_000)
        : null
    timer?.unref()
    try {
      for (;;) {
        while (pending.length === 0) {
          await new Promise<void>((resolve) => {
            resume = resolve
          })
        }
        const next = pending.shift()
        if (next === undefined || next === null) {
          return
        }
        if (next instanceof Error) {
          throw next
        }
        yield next
      }
    } finally {
      if (timer !== null) {
        clearInterval(timer)
      }
    }
  } finally {
    request.signal.removeEventListener("abort", onAbort)
    client.close()
  }
}
