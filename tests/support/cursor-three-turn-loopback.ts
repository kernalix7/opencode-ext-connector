import type http2 from "node:http2"
import type { Http2Server, ServerHttp2Stream } from "node:http2"

import {
  decodeConnectFramesWithRest,
  encodeConnectFrame,
} from "../../src/providers/cursor/connect-frame"
import {
  type AgentClientMessage,
  decodeAgentClientMessage,
} from "../../src/providers/cursor/proto/request"
import {
  type AgentServerMessage,
  encodeAgentServerMessage,
} from "../../src/providers/cursor/proto/server"
import { concatBytes } from "../../src/providers/cursor/proto-wire"

type McpResultMessage = Extract<AgentClientMessage, { readonly kind: "exec-client-message" }>

export type CursorThreeTurnLoopback = {
  readonly completed: Promise<void>
  readonly results: readonly McpResultMessage[]
  readonly resultCount: () => number
  readonly runRequestCount: () => number
  readonly streamCount: () => number
}

function isServerStream(stream: http2.Http2Stream): stream is ServerHttp2Stream {
  return "respond" in stream
}

function frame(message: AgentServerMessage): Uint8Array {
  return encodeConnectFrame(encodeAgentServerMessage(message))
}

function assertExactResult(message: McpResultMessage, expected: McpResultMessage): void {
  if (JSON.stringify(message) !== JSON.stringify(expected)) {
    throw new TypeError(`unexpected MCP result: ${JSON.stringify(message)}`)
  }
}

export function attachCursorThreeTurnLoopback(server: Http2Server): CursorThreeTurnLoopback {
  const completion = Promise.withResolvers<void>()
  const results: McpResultMessage[] = []
  let streamCount = 0
  let runRequestCount = 0
  let resultCount = 0

  const fail = (error: Error, stream?: ServerHttp2Stream): void => {
    completion.reject(error)
    stream?.destroy(error)
  }

  server.on("error", (error) => fail(error))
  server.on("stream", (rawStream) => {
    if (!isServerStream(rawStream)) {
      fail(new TypeError("expected HTTP/2 server stream"))
      return
    }
    streamCount += 1
    let rest = new Uint8Array()
    rawStream.on("error", (error) => fail(error))
    rawStream.respond({ ":status": 200, "content-type": "application/connect+proto" })
    rawStream.on("data", (chunk: Buffer) => {
      try {
        const decoded = decodeConnectFramesWithRest(concatBytes([rest, new Uint8Array(chunk)]))
        rest = new Uint8Array(decoded.rest)
        for (const item of decoded.frames) {
          const message = decodeAgentClientMessage(item.bytes)
          if (message.kind === "run-request") {
            runRequestCount += 1
            rawStream.write(
              frame({
                kind: "exec-server-message",
                message: {
                  kind: "mcp-args",
                  id: 41,
                  execId: "exec-alpha",
                  args: {
                    name: "legacy-read-alpha",
                    args: { path: "alpha.txt" },
                    toolCallId: "call-alpha",
                    providerIdentifier: "opencode",
                    toolName: "read",
                  },
                },
              }),
            )
            continue
          }
          if (message.kind !== "exec-client-message" || message.message.kind !== "mcp-result") {
            continue
          }
          resultCount += 1
          if (resultCount === 1) {
            assertExactResult(message, {
              kind: "exec-client-message",
              message: {
                kind: "mcp-result",
                id: 41,
                execId: "exec-alpha",
                result: {
                  kind: "success",
                  content: [{ kind: "text", text: "alpha file body" }],
                  isError: false,
                },
              },
            })
            results.push(message)
            rawStream.write(
              frame({
                kind: "exec-server-message",
                message: {
                  kind: "mcp-args",
                  id: 52,
                  execId: "exec-beta",
                  args: {
                    name: "legacy-write-beta",
                    args: { path: "beta.txt", content: "from alpha" },
                    toolCallId: "call-beta",
                    providerIdentifier: "opencode",
                    toolName: "write",
                  },
                },
              }),
            )
            continue
          }
          assertExactResult(message, {
            kind: "exec-client-message",
            message: {
              kind: "mcp-result",
              id: 52,
              execId: "exec-beta",
              result: {
                kind: "success",
                content: [{ kind: "text", text: "write complete: beta.txt" }],
                isError: false,
              },
            },
          })
          results.push(message)
          rawStream.end(
            concatBytes([
              frame({
                kind: "interaction-update",
                update: { kind: "text-delta", text: "three-turn complete" },
              }),
              frame({ kind: "interaction-update", update: { kind: "turn-ended" } }),
            ]),
          )
          completion.resolve()
        }
      } catch (error) {
        fail(error instanceof Error ? error : new TypeError("loopback callback failed"), rawStream)
      }
    })
  })

  return {
    completed: completion.promise,
    results,
    resultCount: () => resultCount,
    runRequestCount: () => runRequestCount,
    streamCount: () => streamCount,
  }
}
