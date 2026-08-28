import type http2 from "node:http2"
import type { Http2Server, ServerHttp2Stream } from "node:http2"

import {
  decodeConnectFramesWithRest,
  encodeConnectFrame,
} from "../../src/providers/cursor/connect-frame"
import { decodeAgentClientMessage } from "../../src/providers/cursor/proto/request"
import { encodeAgentServerMessage } from "../../src/providers/cursor/proto/server"
import { concatBytes } from "../../src/providers/cursor/proto-wire"

export type CursorDirectLoopbackObservables = {
  readonly deliveredTo: readonly number[]
  readonly streamCount: () => number
}

function isServerStream(stream: http2.Http2Stream): stream is ServerHttp2Stream {
  return "respond" in stream
}

export function attachCursorDirectLoopback(server: Http2Server): CursorDirectLoopbackObservables {
  let streamCount = 0
  const deliveredTo: number[] = []
  server.on("stream", (rawStream) => {
    if (!isServerStream(rawStream)) throw new TypeError("expected HTTP/2 server stream")
    streamCount += 1
    const streamIndex = streamCount
    const callId = `call-${streamIndex}`
    let rest = new Uint8Array()
    rawStream.respond({ ":status": 200, "content-type": "application/connect+proto" })
    rawStream.on("data", (chunk: Buffer) => {
      const decoded = decodeConnectFramesWithRest(concatBytes([rest, new Uint8Array(chunk)]))
      rest = new Uint8Array(decoded.rest)
      for (const item of decoded.frames) {
        const message = decodeAgentClientMessage(item.bytes)
        if (message.kind === "run-request") {
          const args = {
            name: "read",
            args: { streamIndex },
            toolCallId: callId,
            providerIdentifier: "opencode",
            toolName: "read",
          }
          rawStream.write(
            encodeConnectFrame(
              encodeAgentServerMessage({
                kind: "exec-server-message",
                message: {
                  kind: "mcp-args",
                  id: streamIndex,
                  execId: `exec-${streamIndex}`,
                  args,
                },
              }),
            ),
          )
        }
        if (message.kind === "exec-client-message" && message.message.kind === "mcp-result") {
          deliveredTo.push(streamIndex)
        }
      }
    })
  })
  return { deliveredTo, streamCount: () => streamCount }
}
