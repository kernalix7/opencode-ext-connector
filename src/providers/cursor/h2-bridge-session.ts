// Derived from Rahularya01/pi-cursor's persistent HTTP/2 bridge. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { randomUUID } from "node:crypto"
import { once } from "node:events"
import http2, { type ClientHttp2Session, type ClientHttp2Stream } from "node:http2"

import type { BridgeCommand, BridgeEvent } from "./bridge-protocol.js"
import {
  attachCursorH2ResponseBody,
  bridgeResponseHeaders,
  responseStatus,
} from "./h2-bridge-response.js"
import { CURSOR_CLIENT_VERSION } from "./http2.js"

const PING_INTERVAL_MS = 20_000
const FORCE_CLOSE_MS = 1_000

export type CursorH2BridgeOutput = {
  readonly accessToken: string
  readonly event: BridgeEvent
}

export type CursorH2BridgeEventSink = (output: CursorH2BridgeOutput) => boolean

type ActiveRequest = {
  readonly accessToken: string
  readonly request: ClientHttp2Stream
  terminal: boolean
}

function assertNever(command: never): never {
  void command
  throw new TypeError("unexpected Cursor bridge command")
}

function requestHeaders(
  command: Extract<BridgeCommand, { readonly kind: "open" }>,
): http2.OutgoingHttpHeaders {
  return {
    ...command.headers,
    ":method": "POST",
    ":path": command.path,
    "content-type": "application/connect+proto",
    "connect-protocol-version": "1",
    te: "trailers",
    authorization: `Bearer ${command.accessToken}`,
    "accept-encoding": "gzip, br",
    "x-ghost-mode": "true",
    "x-cursor-client-version": CURSOR_CLIENT_VERSION,
    "x-cursor-client-type": "cli",
    "x-request-id": randomUUID(),
  }
}

export class CursorH2BridgeSession {
  private readonly active = new Map<string, ActiveRequest>()
  private readonly client: ClientHttp2Session
  private readonly pingTimer: ReturnType<typeof setInterval>
  private closing = false

  public constructor(
    endpoint: string,
    private readonly emit: CursorH2BridgeEventSink,
  ) {
    this.client = http2.connect(endpoint)
    this.client.on("error", () => this.failSession("session-error", "Cursor HTTP/2 session failed"))
    this.client.on("goaway", () =>
      this.failSession("session-goaway", "Cursor HTTP/2 session received GOAWAY"),
    )
    this.pingTimer = setInterval(() => {
      if (!this.client.closed && !this.client.destroyed) {
        this.client.ping((error) => {
          if (error !== null) {
            this.failSession("session-ping-error", "Cursor HTTP/2 session PING failed")
          }
        })
      }
    }, PING_INTERVAL_MS)
    this.pingTimer.unref()
  }

  public async handle(command: BridgeCommand): Promise<void> {
    switch (command.kind) {
      case "open":
        this.open(command)
        return
      case "write-frame":
        await this.write(command.id, command.payload)
        return
      case "abort":
        this.abort(command.id)
        return
      case "close":
        this.closeRequest(command.id)
        return
      default:
        return assertNever(command)
    }
  }

  private open(command: Extract<BridgeCommand, { readonly kind: "open" }>): void {
    if (this.closing || this.active.has(command.id)) {
      this.emitError(
        command.id,
        command.accessToken,
        "stream-unavailable",
        "Cursor stream cannot be opened",
      )
      return
    }
    const request = this.client.request(requestHeaders(command))
    const active: ActiveRequest = { accessToken: command.accessToken, request, terminal: false }
    this.active.set(command.id, active)
    request.once("response", (headers) => {
      this.emit({
        accessToken: active.accessToken,
        event: {
          kind: "headers",
          id: command.id,
          status: responseStatus(headers),
          headers: bridgeResponseHeaders(headers),
        },
      })
      attachCursorH2ResponseBody(request, headers, {
        onData: (payload) =>
          this.emit({
            accessToken: active.accessToken,
            event: { kind: "data", id: command.id, payload },
          }),
        onEnd: () => this.finish(command.id, active),
        onError: (code, message) => this.finishError(command.id, active, code, message),
      })
    })
    request.on("trailers", (headers) => {
      this.emit({
        accessToken: active.accessToken,
        event: { kind: "trailers", id: command.id, headers: bridgeResponseHeaders(headers) },
      })
    })
    request.once("error", () =>
      this.finishError(command.id, active, "stream-error", "Cursor HTTP/2 stream failed"),
    )
    this.emit({ accessToken: active.accessToken, event: { kind: "opened", id: command.id } })
  }

  private async write(id: string, payload: Uint8Array): Promise<void> {
    const active = this.active.get(id)
    if (
      active === undefined ||
      active.terminal ||
      active.request.destroyed ||
      active.request.writableEnded
    ) {
      this.emitError(
        id,
        active?.accessToken ?? "",
        "stream-unavailable",
        "Cursor stream is unavailable",
      )
      return
    }
    if (!active.request.write(payload)) {
      await once(active.request, "drain")
    }
  }

  private abort(id: string): void {
    const active = this.active.get(id)
    if (active === undefined) {
      return
    }
    active.request.close(http2.constants.NGHTTP2_CANCEL)
    this.finish(id, active)
    this.active.delete(id)
  }

  private closeRequest(id: string): void {
    const active = this.active.get(id)
    if (active === undefined) {
      return
    }
    active.request.end()
    this.active.delete(id)
  }

  private finish(id: string, active: ActiveRequest): void {
    if (active.terminal) {
      return
    }
    active.terminal = true
    this.emit({ accessToken: active.accessToken, event: { kind: "end", id } })
  }

  private finishError(id: string, active: ActiveRequest, code: string, message: string): void {
    if (active.terminal) {
      return
    }
    active.terminal = true
    this.active.delete(id)
    active.request.close(http2.constants.NGHTTP2_CANCEL)
    this.emitError(id, active.accessToken, code, message)
  }

  private emitError(id: string, accessToken: string, code: string, message: string): void {
    this.emit({ accessToken, event: { kind: "error", id, code, message } })
  }

  private failSession(code: string, message: string): void {
    if (this.closing) {
      return
    }
    this.closing = true
    clearInterval(this.pingTimer)
    for (const [id, active] of this.active) {
      active.request.close(http2.constants.NGHTTP2_CANCEL)
      if (!active.terminal) {
        active.terminal = true
        this.emitError(id, active.accessToken, code, message)
      }
    }
    this.active.clear()
    this.client.destroy()
  }

  public async close(): Promise<void> {
    if (this.closing) {
      return
    }
    this.closing = true
    clearInterval(this.pingTimer)
    for (const [id, active] of this.active) {
      active.request.close(http2.constants.NGHTTP2_CANCEL)
      this.finish(id, active)
    }
    this.active.clear()
    this.client.close()
    if (this.client.closed || this.client.destroyed) {
      return
    }
    await Promise.race([
      once(this.client, "close"),
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.client.destroy()
          resolve()
        }, FORCE_CLOSE_MS)
        timer.unref()
      }),
    ])
  }
}
