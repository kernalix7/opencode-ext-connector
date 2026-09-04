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
import { CursorRunSessionError } from "../../src/providers/cursor/run-session"
import { FakeClock } from "../support/clock"
import { attachCursorDirectLoopback } from "../support/cursor-direct-loopback"
import { getTestPackageDist } from "../support/test-package"

const childUrl = pathToFileURL(join(getTestPackageDist(), "providers", "cursor", "h2-bridge.js"))
const servers = new Set<Http2Server>()

function isServerStream(stream: http2.Http2Stream): stream is ServerHttp2Stream {
  return "respond" in stream
}

function frame(message: Parameters<typeof encodeAgentServerMessage>[0]): Uint8Array {
  return encodeConnectFrame(encodeAgentServerMessage(message))
}

async function listen(server: Http2Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("missing test port")
  return address.port
}

afterEach(async () => {
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  servers.clear()
})

describe("Cursor direct Run isolation", () => {
  it("creates independent Runs for fresh identical prompts", async () => {
    // Given
    let streamCount = 0
    const runRequests: number[] = []
    const deliveredTo: number[] = []
    const closedThird = Promise.withResolvers<void>()
    const server = http2.createServer()
    servers.add(server)
    server.on("stream", (rawStream) => {
      if (!isServerStream(rawStream)) throw new TypeError("expected HTTP/2 server stream")
      streamCount += 1
      const streamIndex = streamCount
      const callId = `call-${streamIndex}`
      let rest = new Uint8Array()
      rawStream.respond({ ":status": 200, "content-type": "application/connect+proto" })
      if (streamIndex === 3) rawStream.once("close", () => closedThird.resolve())
      rawStream.on("data", (chunk: Buffer) => {
        const decoded = decodeConnectFramesWithRest(concatBytes([rest, new Uint8Array(chunk)]))
        rest = new Uint8Array(decoded.rest)
        for (const item of decoded.frames) {
          const message = decodeAgentClientMessage(item.bytes)
          if (message.kind === "run-request" && streamIndex < 3) {
            runRequests.push(streamIndex)
            const args = {
              name: "read",
              args: { streamIndex },
              toolCallId: callId,
              providerIdentifier: "opencode",
              toolName: "read",
            }
            rawStream.write(
              concatBytes([
                frame({
                  kind: "interaction-update",
                  update: {
                    kind: "tool-call-started",
                    callId,
                    modelCallId: `m-${streamIndex}`,
                    args,
                  },
                }),
                frame({
                  kind: "exec-server-message",
                  message: {
                    kind: "mcp-args",
                    id: streamIndex,
                    execId: `exec-${streamIndex}`,
                    args,
                  },
                }),
              ]),
            )
          }
          if (message.kind === "exec-client-message" && message.message.kind === "mcp-result") {
            deliveredTo.push(streamIndex)
            rawStream.end(frame({ kind: "interaction-update", update: { kind: "turn-ended" } }))
          }
        }
      })
    })
    const port = await listen(server)
    const runtime = createCursorDirectRuntime({
      clock: new FakeClock(),
      readAccessToken: async () => "isolation-token",
      onBackgroundCleanupError: () => undefined,
      createBridgeClient: (signal) =>
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
    const tools = [{ type: "function" as const, name: "read", inputSchema: { type: "object" } }]
    const firstUser = { role: "user" as const, content: [{ type: "text" as const, text: "same" }] }
    const secondUser = {
      role: "user" as const,
      content: [{ type: "text" as const, text: "same" }],
    }
    const firstParts = await Array.fromAsync(
      (await model.doStream({ prompt: [firstUser], tools })).stream,
    )
    const secondParts = await Array.fromAsync(
      (await model.doStream({ prompt: [secondUser], tools })).stream,
    )

    // When
    const continued = await model.doStream({
      tools,
      prompt: [
        secondUser,
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call-2", toolName: "read", input: {} }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-2",
              toolName: "read",
              output: { type: "json", value: { ok: true } },
            },
          ],
        },
      ],
    })
    await Array.fromAsync(continued.stream)
    const abortController = new AbortController()
    const cancelled = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "cancel me" }] }],
      abortSignal: abortController.signal,
    })
    const cancellation = Array.fromAsync(cancelled.stream)
    abortController.abort()

    // Then
    expect(
      firstParts.some((part) => part.type === "tool-call" && part.toolCallId === "call-1"),
    ).toBe(true)
    expect(
      secondParts.some((part) => part.type === "tool-call" && part.toolCallId === "call-2"),
    ).toBe(true)
    expect(deliveredTo).toEqual([2])
    expect(runRequests).toEqual([1, 2])
    await expect(cancellation).rejects.toThrow()
    await closedThird.promise
    await runtime.dispose()
    expect(streamCount).toBe(3)
  })

  it("rejects mixed parked-call ownership before a bridge write", async () => {
    // Given
    const server = http2.createServer()
    servers.add(server)
    const loopback = attachCursorDirectLoopback(server)
    const port = await listen(server)
    const runtime = createCursorDirectRuntime({
      clock: new FakeClock(),
      readAccessToken: async () => "isolation-token",
      onBackgroundCleanupError: () => undefined,
      createBridgeClient: (signal) =>
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
    const tools = [{ type: "function" as const, name: "read", inputSchema: { type: "object" } }]
    const firstUser = { role: "user" as const, content: [{ type: "text" as const, text: "first" }] }
    const secondUser = {
      role: "user" as const,
      content: [{ type: "text" as const, text: "second" }],
    }
    await Array.fromAsync((await model.doStream({ prompt: [firstUser], tools })).stream)
    await Array.fromAsync((await model.doStream({ prompt: [secondUser], tools })).stream)

    // When
    const continuation = model.doStream({
      tools,
      prompt: [
        secondUser,
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "call-2", toolName: "read", input: {} },
            { type: "tool-call", toolCallId: "call-1", toolName: "read", input: {} },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-2",
              toolName: "read",
              output: { type: "json", value: {} },
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "read",
              output: { type: "json", value: {} },
            },
          ],
        },
      ],
    })

    // Then
    await expect(continuation).rejects.toMatchObject({
      name: CursorRunSessionError.name,
      reason: "mismatched-result",
    })
    expect(loopback.deliveredTo).toEqual([])
    expect(loopback.streamCount()).toBe(2)
    await runtime.dispose()
  })
})
