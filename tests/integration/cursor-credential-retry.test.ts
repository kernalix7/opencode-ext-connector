import { afterEach, describe, expect, it } from "bun:test"
import http2, { type Http2Server, type ServerHttp2Stream } from "node:http2"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createCursorBridgeClient } from "../../src/providers/cursor/bridge-client"
import { createNodeCursorBridgeProcessFactory } from "../../src/providers/cursor/bridge-process"
import {
  decodeConnectFramesWithRest,
  encodeConnectFrame,
} from "../../src/providers/cursor/connect-frame"
import { createCursorDirectRuntime } from "../../src/providers/cursor/direct-runtime"
import { createCursorLanguageModel } from "../../src/providers/cursor/language-model"
import { decodeAgentClientMessage } from "../../src/providers/cursor/proto/request"
import { encodeAgentServerMessage } from "../../src/providers/cursor/proto/server"
import { concatBytes } from "../../src/providers/cursor/proto-wire"
import { FakeClock } from "../support/clock"
import { getTestPackageDist } from "../support/test-package"

const childUrl = pathToFileURL(join(getTestPackageDist(), "providers", "cursor", "h2-bridge.js"))
const servers = new Set<Http2Server>()

async function listen(server: Http2Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("missing test port")
  return address.port
}

function isServerStream(stream: http2.Http2Stream): stream is ServerHttp2Stream {
  return "respond" in stream
}

afterEach(async () => {
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  servers.clear()
})

describe("Cursor direct built-bridge credential retry", () => {
  it("parks and continues only the changed-token physical attempt", async () => {
    // Given
    const server = http2.createServer()
    servers.add(server)
    const completed = Promise.withResolvers<void>()
    const authorizations: string[] = []
    let streamCount = 0
    let runRequestCount = 0
    let resultCount = 0
    server.on("stream", (rawStream, headers) => {
      if (!isServerStream(rawStream)) {
        rawStream.destroy(new TypeError("expected HTTP/2 server stream"))
        return
      }
      const stream = rawStream
      streamCount += 1
      const authorization = headers.authorization
      if (typeof authorization !== "string") {
        stream.destroy(new TypeError("missing authorization"))
        return
      }
      authorizations.push(authorization)
      if (authorization === "Bearer expired-token") {
        stream.respond({ ":status": 401 })
        stream.end()
        return
      }
      handleSuccessfulAttempt(stream)
    })
    const handleSuccessfulAttempt = (stream: ServerHttp2Stream): void => {
      let rest = new Uint8Array()
      stream.respond({ ":status": 200, "content-type": "application/connect+proto" })
      stream.on("data", (chunk: Buffer) => {
        const decoded = decodeConnectFramesWithRest(concatBytes([rest, new Uint8Array(chunk)]))
        rest = new Uint8Array(decoded.rest)
        for (const item of decoded.frames) {
          const message = decodeAgentClientMessage(item.bytes)
          if (message.kind === "run-request") {
            runRequestCount += 1
            stream.write(
              encodeConnectFrame(
                encodeAgentServerMessage({
                  kind: "exec-server-message",
                  message: {
                    kind: "mcp-args",
                    id: 71,
                    execId: "exec-reloaded",
                    args: {
                      name: "legacy-read",
                      args: { path: "reloaded.txt" },
                      toolCallId: "call-reloaded",
                      providerIdentifier: "opencode",
                      toolName: "read",
                    },
                  },
                }),
              ),
            )
            continue
          }
          if (message.kind !== "exec-client-message" || message.message.kind !== "mcp-result") {
            continue
          }
          resultCount += 1
          stream.end(
            encodeConnectFrame(
              encodeAgentServerMessage({
                kind: "interaction-update",
                update: { kind: "turn-ended" },
              }),
            ),
          )
          completed.resolve()
        }
      })
    }
    const port = await listen(server)
    const tokens = ["expired-token", "current-token"]
    const runtime = createCursorDirectRuntime({
      clock: new FakeClock(),
      readAccessToken: async () => tokens.shift() ?? null,
      onBackgroundCleanupError: () => undefined,
      createBridgeClient: async (signal) =>
        createCursorBridgeClient({
          signal,
          processFactory: createNodeCursorBridgeProcessFactory({
            childUrl,
            endpoint: `http://127.0.0.1:${port}`,
            env: { PATH: process.env["PATH"] },
          }),
        }),
    })
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => null,
      directRuntime: runtime,
    })
    const opener = {
      role: "user" as const,
      content: [{ type: "text" as const, text: "read the reloaded file" }],
    }
    const tool = { type: "function" as const, name: "read", inputSchema: { type: "object" } }

    try {
      // When
      const firstParts = await Array.fromAsync(
        (await model.doStream({ prompt: [opener], tools: [tool] })).stream,
      )
      const secondParts = await Array.fromAsync(
        (
          await model.doStream({
            tools: [tool],
            prompt: [
              opener,
              {
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "call-reloaded",
                    toolName: "read",
                    input: { path: "reloaded.txt" },
                  },
                ],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: "call-reloaded",
                    toolName: "read",
                    output: { type: "text", value: "reloaded body" },
                  },
                ],
              },
            ],
          })
        ).stream,
      )
      await completed.promise

      // Then
      expect(firstParts.filter((part) => part.type === "stream-start")).toHaveLength(1)
      expect(firstParts.filter((part) => part.type === "tool-call")).toEqual([
        {
          type: "tool-call",
          toolCallId: "call-reloaded",
          toolName: "read",
          input: JSON.stringify({ path: "reloaded.txt" }),
        },
      ])
      expect(secondParts.filter((part) => part.type === "tool-call")).toEqual([])
      expect(streamCount).toBe(2)
      expect(runRequestCount).toBe(1)
      expect(resultCount).toBe(1)
      expect(authorizations).toHaveLength(2)
      expect(tokens).toEqual([])
    } finally {
      await runtime.dispose()
    }
  })
})
