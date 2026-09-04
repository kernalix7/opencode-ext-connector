import { afterEach, describe, expect, it } from "bun:test"
import http2, { type Http2Server, type ServerHttp2Stream } from "node:http2"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createCursorBridgeClient } from "../../src/providers/cursor/bridge-client"
import { createNodeCursorBridgeProcessFactory } from "../../src/providers/cursor/bridge-process"
import { getTestPackageDist } from "../support/test-package"

const childUrl = pathToFileURL(join(getTestPackageDist(), "providers", "cursor", "h2-bridge.js"))
const token = "integration-parent-secret"
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
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  servers.clear()
})

describe("Cursor bridge parent lifecycle", () => {
  it("owns one Node child across receive, abort, and repeated disposal", async () => {
    // Given
    const aborted = Promise.withResolvers<void>()
    let streamCount = 0
    const server = http2.createServer()
    servers.add(server)
    server.on("stream", (stream, headers) => {
      if (!isServerStream(stream)) throw new TypeError("fixture received a non-server stream")
      streamCount += 1
      expect(headers.authorization).toBe(`Bearer ${token}`)
      stream.respond({ ":status": 200, "content-type": "application/connect+proto" })
      if (streamCount === 1) {
        stream.on("data", (chunk: Buffer) =>
          stream.end(Buffer.from(`received:${chunk.toString()}`)),
        )
      } else {
        stream.once("close", () => aborted.resolve())
      }
    })
    const port = await listen(server)
    const listenerCounts = ["beforeExit", "SIGINT", "SIGTERM"].map((event) =>
      process.listenerCount(event),
    )
    const { PATH } = process.env
    const client = await createCursorBridgeClient({
      processFactory: createNodeCursorBridgeProcessFactory({
        childUrl,
        endpoint: `http://127.0.0.1:${port}`,
        env: { PATH },
      }),
    })
    const pid = client.pid

    // When
    const first = await client.open({
      id: "manual-1",
      accessToken: token,
      path: "/agent.v1.AgentService/Run",
      headers: {},
      signal: new AbortController().signal,
    })
    await first.nextEvent()
    await first.write(Buffer.from("frame"))
    const firstEvents = [await first.nextEvent(), await first.nextEvent(), await first.nextEvent()]
    const second = await client.open({
      id: "manual-2",
      accessToken: token,
      path: "/agent.v1.AgentService/Run",
      headers: {},
      signal: new AbortController().signal,
    })
    await second.nextEvent()
    await second.abort()
    await aborted.promise
    const disposal = client.dispose()
    const repeatedDisposal = client.dispose()

    // Then
    expect(disposal).toBe(repeatedDisposal)
    await disposal
    expect(
      firstEvents.some(
        (event) =>
          event.kind === "data" && Buffer.from(event.payload).toString() === "received:frame",
      ),
    ).toBe(true)
    expect(streamCount).toBe(2)
    expect(() => process.kill(pid, 0)).toThrow()
    expect(
      ["beforeExit", "SIGINT", "SIGTERM"].map((event) => process.listenerCount(event)),
    ).toEqual(listenerCounts)
  })
})
