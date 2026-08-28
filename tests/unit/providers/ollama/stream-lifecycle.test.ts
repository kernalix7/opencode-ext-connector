import { describe, expect, it } from "bun:test"
import { getEventListeners } from "node:events"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

import { createOllamaLanguageModel, type OllamaRuntime } from "../../../../src/providers/ollama"

const prompt: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]

function modelWith(response: (signal: AbortSignal) => Response) {
  const runtime: OllamaRuntime = { openChat: async (_request, signal) => response(signal) }
  return createOllamaLanguageModel({ modelId: "m", runtime })
}

function response(doneReason = "stop"): Response {
  return new Response(
    `${JSON.stringify({ message: { content: "ok", thinking: "why" }, done: true, done_reason: doneReason })}\n`,
  )
}

describe("Ollama stream lifecycle", () => {
  it.each([
    ["stop", "stop"],
    ["length", "length"],
    ["content_filter", "content-filter"],
    ["new_reason", "other"],
  ])("maps %s finish reason to %s", async (raw, unified) => {
    // Given
    const model = modelWith(() => response(raw))
    // When
    const parts = await Array.fromAsync((await model.doStream({ prompt })).stream)
    // Then
    expect(parts.find((part) => part.type === "finish")).toMatchObject({
      finishReason: { raw, unified },
    })
  })

  it("removes the caller abort listener after normal stream termination", async () => {
    // Given
    const caller = new AbortController()
    const model = modelWith(() => response())
    // When
    const stream = (await model.doStream({ prompt, abortSignal: caller.signal })).stream
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(1)
    await Array.fromAsync(stream)
    // Then
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0)
  })

  it("removes the caller abort listener after a malformed stream error", async () => {
    // Given
    const caller = new AbortController()
    const model = modelWith(() => new Response("private malformed json\n"))
    // When
    const parts = await Array.fromAsync(
      (await model.doStream({ prompt, abortSignal: caller.signal })).stream,
    )
    // Then
    expect(parts.some((part) => part.type === "error")).toBe(true)
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0)
  })

  it("removes the caller abort listener when the returned stream is cancelled", async () => {
    // Given
    const caller = new AbortController()
    const model = modelWith(
      (signal) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller): void {
              signal.addEventListener("abort", () => controller.error(signal.reason), {
                once: true,
              })
            },
          }),
        ),
    )
    const stream = (await model.doStream({ prompt, abortSignal: caller.signal })).stream
    // When
    await stream.cancel()
    // Then
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0)
  })
})
