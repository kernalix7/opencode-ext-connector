import { afterEach, describe, expect, it } from "bun:test"
import http2, { type Http2Server } from "node:http2"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createCursorBridgeClient } from "../../src/providers/cursor/bridge-client"
import { createNodeCursorBridgeProcessFactory } from "../../src/providers/cursor/bridge-process"
import { createCursorDirectRuntime } from "../../src/providers/cursor/direct-runtime"
import { createCursorLanguageModel } from "../../src/providers/cursor/language-model"
import { FakeClock } from "../support/clock"
import { attachCursorThreeTurnLoopback } from "../support/cursor-three-turn-loopback"

const projectRoot = join(import.meta.dir, "..", "..")
const childUrl = pathToFileURL(join(projectRoot, "dist", "providers", "cursor", "h2-bridge.js"))
const servers = new Set<Http2Server>()
const ignoreBackgroundCleanupError = (): void => undefined

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

describe("Cursor direct Run continuation", () => {
  it("continues two MCP results over one built-child HTTP/2 Run stream", async () => {
    // Given
    const server = http2.createServer()
    servers.add(server)
    const observed = attachCursorThreeTurnLoopback(server)
    const port = await listen(server)
    const listenerCounts = ["beforeExit", "SIGINT", "SIGTERM"].map((event) =>
      process.listenerCount(event),
    )
    let pid = 0
    const clock = new FakeClock()
    const runtime = createCursorDirectRuntime({
      clock,
      readAccessToken: async () => "loopback-token",
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
      createBridgeClient: async (signal) => {
        const client = await createCursorBridgeClient({
          signal,
          processFactory: createNodeCursorBridgeProcessFactory({
            childUrl,
            endpoint: `http://127.0.0.1:${port}`,
            env: { PATH: process.env["PATH"] },
          }),
        })
        pid = client.pid
        return client
      },
    })
    const model = createCursorLanguageModel({
      modelId: "auto",
      runPrompt: async () => null,
      directRuntime: runtime,
    })
    const tools = [
      { type: "function" as const, name: "read", inputSchema: { type: "object" } },
      { type: "function" as const, name: "write", inputSchema: { type: "object" } },
    ]
    const opener = {
      role: "user" as const,
      content: [{ type: "text" as const, text: "copy alpha to beta" }],
    }
    const callAlpha = {
      type: "tool-call" as const,
      toolCallId: "call-alpha",
      toolName: "read",
      input: { path: "alpha.txt" },
    }
    const resultAlpha = {
      type: "tool-result" as const,
      toolCallId: "call-alpha",
      toolName: "read",
      output: { type: "text" as const, value: "alpha file body" },
    }
    const callBeta = {
      type: "tool-call" as const,
      toolCallId: "call-beta",
      toolName: "write",
      input: { path: "beta.txt", content: "from alpha" },
    }
    const resultBeta = {
      type: "tool-result" as const,
      toolCallId: "call-beta",
      toolName: "write",
      output: { type: "text" as const, value: "write complete: beta.txt" },
    }

    try {
      // When
      const firstParts = await Array.fromAsync(
        (await model.doStream({ prompt: [opener], tools })).stream,
      )
      expect(observed.runRequestCount()).toBe(1)
      const secondParts = await Array.fromAsync(
        (
          await model.doStream({
            tools,
            prompt: [
              opener,
              { role: "assistant", content: [callAlpha] },
              { role: "tool", content: [resultAlpha] },
            ],
          })
        ).stream,
      )
      expect(observed.runRequestCount()).toBe(1)
      const thirdParts = await Array.fromAsync(
        (
          await model.doStream({
            tools,
            prompt: [
              opener,
              { role: "assistant", content: [callAlpha] },
              { role: "tool", content: [resultAlpha] },
              { role: "assistant", content: [callBeta] },
              { role: "tool", content: [resultBeta] },
            ],
          })
        ).stream,
      )
      await observed.completed

      // Then
      expect(firstParts.filter((part) => part.type === "tool-call")).toEqual([
        {
          type: "tool-call",
          toolCallId: "call-alpha",
          toolName: "read",
          input: JSON.stringify({ path: "alpha.txt" }),
        },
      ])
      expect(firstParts.at(-1)).toMatchObject({
        type: "finish",
        finishReason: { unified: "tool-calls" },
      })
      expect(secondParts.filter((part) => part.type === "tool-call")).toEqual([
        {
          type: "tool-call",
          toolCallId: "call-beta",
          toolName: "write",
          input: JSON.stringify({ path: "beta.txt", content: "from alpha" }),
        },
      ])
      expect(secondParts.at(-1)).toMatchObject({
        type: "finish",
        finishReason: { unified: "tool-calls" },
      })
      expect(thirdParts.filter((part) => part.type === "tool-call")).toEqual([])
      expect(
        thirdParts.some(
          (part) => part.type === "text-delta" && part.delta === "three-turn complete",
        ),
      ).toBe(true)
      expect(thirdParts.at(-1)).toMatchObject({
        type: "finish",
        finishReason: { unified: "stop" },
      })
      expect(observed.results).toEqual([
        {
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
        },
        {
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
        },
      ])
      expect(observed.streamCount()).toBe(1)
      expect(observed.runRequestCount()).toBe(1)
      expect(observed.resultCount()).toBe(2)
    } finally {
      await runtime.dispose()
    }

    expect(clock.pendingCount()).toBe(0)
    expect(() => process.kill(pid, 0)).toThrow()
    expect(
      ["beforeExit", "SIGINT", "SIGTERM"].map((event) => process.listenerCount(event)),
    ).toEqual(listenerCounts)
  })
})
