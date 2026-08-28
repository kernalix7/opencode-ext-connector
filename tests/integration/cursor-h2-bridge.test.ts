import { afterEach, describe, expect, it } from "bun:test"
import http2, { type Http2Server, type ServerHttp2Stream } from "node:http2"
import { brotliCompressSync, gzipSync } from "node:zlib"

import type { BridgeEvent } from "../../src/providers/cursor/bridge-protocol"
import { CURSOR_CLIENT_VERSION } from "../../src/providers/cursor/http2"
import {
  cursorH2BridgeExitCode,
  killCursorH2BridgeChildren,
  sendBridgeCommand,
  startCursorH2Bridge,
} from "../support/cursor-h2-process"

const token = "integration-secret-token"
const servers = new Set<Http2Server>()

function isServerStream(stream: http2.Http2Stream): stream is ServerHttp2Stream {
  return "respond" in stream
}

async function listen(server: Http2Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new TypeError("HTTP/2 fixture did not expose a TCP address")
  }
  return address.port
}

afterEach(async () => {
  killCursorH2BridgeChildren()
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  servers.clear()
})

describe("Cursor HTTP/2 bridge child", () => {
  for (const fixture of [
    { encoding: "gzip", compress: gzipSync },
    { encoding: "br", compress: brotliCompressSync },
  ]) {
    it(`decodes negotiated ${fixture.encoding} HTTP response bodies`, async () => {
      // Given
      const server = http2.createServer()
      servers.add(server)
      server.on("stream", (stream, headers) => {
        if (!isServerStream(stream)) {
          throw new TypeError("HTTP/2 fixture received a non-server stream")
        }
        expect(headers["accept-encoding"]).toBe("gzip, br")
        stream.respond({ ":status": 200, "content-encoding": fixture.encoding })
        stream.end(fixture.compress(Buffer.from("decoded-body")))
      })
      const port = await listen(server)
      const bridge = startCursorH2Bridge(`http://127.0.0.1:${port}`)

      // When
      sendBridgeCommand(bridge.child, {
        kind: "open",
        id: "compressed",
        accessToken: token,
        path: "/agent.v1.AgentService/Run",
        headers: {},
      })
      await bridge.waitFor((event) => event.kind === "end")
      sendBridgeCommand(bridge.child, { kind: "close", id: "compressed" })
      bridge.child.stdin.end()

      // Then
      const body = bridge.events
        .filter(
          (event): event is Extract<BridgeEvent, { readonly kind: "data" }> =>
            event.kind === "data",
        )
        .map((event) => Buffer.from(event.payload))
      expect(Buffer.concat(body).toString()).toBe("decoded-body")
      expect(await cursorH2BridgeExitCode(bridge.child)).toBe(0)
    })
  }

  it("emits only a stable protocol error when stdin is malformed", async () => {
    // Given
    const server = http2.createServer()
    servers.add(server)
    const port = await listen(server)
    const bridge = startCursorH2Bridge(`http://127.0.0.1:${port}`)

    // When
    bridge.child.stdin.end("{malformed\n")
    const event = await bridge.waitFor((candidate) => candidate.kind === "error")

    // Then
    expect(event).toEqual({
      kind: "error",
      id: "bridge",
      code: "malformed-json",
      message: "Cursor bridge command was rejected",
    })
    expect(await cursorH2BridgeExitCode(bridge.child)).toBe(1)
    expect(bridge.events).toEqual([event])
  })

  it("keeps one session for same-stream bidi writes, trailers, and a later aborted stream", async () => {
    // Given
    const requestChunks: Buffer[] = []
    const streams: ServerHttp2Stream[] = []
    const secondStream = Promise.withResolvers<ServerHttp2Stream>()
    const secondStreamClosed = Promise.withResolvers<void>()
    const server = http2.createServer()
    servers.add(server)
    server.on("stream", (stream, headers) => {
      if (!isServerStream(stream)) {
        throw new TypeError("HTTP/2 fixture received a non-server stream")
      }
      streams.push(stream)
      if (streams.length === 1) {
        expect(headers[":method"]).toBe("POST")
        expect(headers[":path"]).toBe("/agent.v1.AgentService/Run")
        expect(headers["content-type"]).toBe("application/connect+proto")
        expect(headers["connect-protocol-version"]).toBe("1")
        expect(headers["te"]).toBe("trailers")
        expect(headers.authorization).toBe(`Bearer ${token}`)
        expect(headers["x-ghost-mode"]).toBe("true")
        expect(headers["x-cursor-client-version"]).toBe(CURSOR_CLIENT_VERSION)
        expect(headers["x-cursor-client-type"]).toBe("cli")
        expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/)
        expect(headers["x-parent"]).toBe("allowed")
        stream.respond(
          { ":status": 200, "content-type": "application/connect+proto", "x-response": "kept" },
          { waitForTrailers: true },
        )
        stream.on("wantTrailers", () => stream.sendTrailers({ "connect-status": "0" }))
        stream.on("data", (chunk: Buffer) => {
          requestChunks.push(chunk)
          if (requestChunks.length === 1) {
            stream.write(Buffer.from("server-tool-frame"))
          } else {
            stream.end(Buffer.from("server-final-frame"))
          }
        })
      } else {
        stream.respond({ ":status": 200, "content-type": "application/connect+proto" })
        stream.once("close", () => secondStreamClosed.resolve())
        secondStream.resolve(stream)
      }
    })
    const port = await listen(server)
    const bridge = startCursorH2Bridge(`http://127.0.0.1:${port}`)

    // When
    sendBridgeCommand(bridge.child, {
      kind: "open",
      id: "run-1",
      accessToken: token,
      path: "/agent.v1.AgentService/Run",
      headers: { "content-type": "text/plain", "x-parent": "allowed" },
    })
    await bridge.waitFor((event) => event.kind === "opened" && event.id === "run-1")
    sendBridgeCommand(bridge.child, {
      kind: "write-frame",
      id: "run-1",
      payload: Buffer.from("initial"),
    })
    await bridge.waitFor(
      (event) =>
        event.kind === "data" && Buffer.from(event.payload).toString() === "server-tool-frame",
    )
    sendBridgeCommand(bridge.child, {
      kind: "write-frame",
      id: "run-1",
      payload: Buffer.from("second"),
    })
    await bridge.waitFor((event) => event.kind === "end" && event.id === "run-1")
    sendBridgeCommand(bridge.child, {
      kind: "write-frame",
      id: "run-1",
      payload: Buffer.from("post-terminal"),
    })
    await bridge.waitFor(
      (event) =>
        event.kind === "error" && event.id === "run-1" && event.code === "stream-unavailable",
    )
    sendBridgeCommand(bridge.child, { kind: "close", id: "run-1" })
    sendBridgeCommand(bridge.child, {
      kind: "open",
      id: "run-2",
      accessToken: token,
      path: "/agent.v1.AgentService/Run",
      headers: {},
    })
    await bridge.waitFor((event) => event.kind === "opened" && event.id === "run-2")
    await secondStream.promise
    sendBridgeCommand(bridge.child, { kind: "abort", id: "run-2" })
    await secondStreamClosed.promise
    sendBridgeCommand(bridge.child, { kind: "close", id: "run-2" })
    bridge.child.stdin.end()

    // Then
    expect(requestChunks.map((chunk) => chunk.toString())).toEqual(["initial", "second"])
    expect(streams).toHaveLength(2)
    expect(
      bridge.events.some(
        (event) =>
          event.kind === "headers" &&
          event.id === "run-1" &&
          event.headers["x-response"] === "kept",
      ),
    ).toBe(true)
    expect(
      bridge.events.some(
        (event) =>
          event.kind === "trailers" &&
          event.id === "run-1" &&
          event.headers["connect-status"] === "0",
      ),
    ).toBe(true)
    expect(await cursorH2BridgeExitCode(bridge.child)).toBe(0)
    expect(bridge.child.stderr.read()?.toString() ?? "").not.toContain(token)
  })
})
