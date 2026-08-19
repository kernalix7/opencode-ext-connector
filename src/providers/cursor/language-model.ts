// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors"
import { parseProviderId } from "../../core/ids"
import { cursorPromptText } from "./prompt"
import { cursorToolParts } from "./tool-stream"

export type CursorLanguageModelOptions = {
  readonly modelId: string
  readonly runPrompt: (prompt: string, signal: AbortSignal) => Promise<string | null>
  readonly streamNdjson?: (prompt: string, signal: AbortSignal) => AsyncIterable<string>
}

function emptyUsage(): {
  readonly inputTokens: {
    readonly total: undefined
    readonly noCache: undefined
    readonly cacheRead: undefined
    readonly cacheWrite: undefined
  }
  readonly outputTokens: {
    readonly total: undefined
    readonly text: undefined
    readonly reasoning: undefined
  }
} {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  }
}

export function createCursorLanguageModel(options: CursorLanguageModelOptions): LanguageModelV3 {
  const provider = parseProviderId("cursor")
  return {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async (call: LanguageModelV3CallOptions) => {
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("cursor-generate")
      }
      const text = await options.runPrompt(cursorPromptText(call.prompt), signal)
      if (text === null) {
        throw new AdapterError({
          operation: "cursor-agent-unavailable",
          retryable: false,
          cause: null,
          providerId: provider,
        })
      }
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: emptyUsage(),
        warnings: [],
      }
    },
    doStream: async (call: LanguageModelV3CallOptions) => {
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("cursor-stream")
      }
      const prompt = cursorPromptText(call.prompt)

      const streamNdjson = options.streamNdjson
      if (streamNdjson !== undefined) {
        const stream = new ReadableStream({
          async start(controller) {
            try {
              let started = false
              let textStarted = false
              for await (const line of streamNdjson(prompt, signal)) {
                if (signal.aborted) {
                  throw new OperationCancelledError("cursor-stream")
                }
                const trimmed = line.trim()
                if (trimmed.length === 0) {
                  continue
                }
                let parsed: unknown
                try {
                  parsed = JSON.parse(trimmed)
                } catch {
                  continue
                }
                if (typeof parsed !== "object" || parsed === null) {
                  continue
                }
                const type = "type" in parsed && typeof parsed.type === "string" ? parsed.type : ""
                if (type === "thinking") {
                  continue
                }
                if (!started) {
                  controller.enqueue({ type: "stream-start", warnings: [] })
                  started = true
                }
                const toolParts = cursorToolParts(parsed)
                for (const part of toolParts) {
                  controller.enqueue(part)
                }
                const text = "text" in parsed && typeof parsed.text === "string" ? parsed.text : ""
                const delta =
                  "delta" in parsed && typeof parsed.delta === "string" ? parsed.delta : ""
                const nextText = text.length > 0 ? text : delta
                if (nextText.length > 0 && type !== "tool_call") {
                  if (!textStarted) {
                    controller.enqueue({ type: "text-start", id: "text-1" })
                    textStarted = true
                  }
                  controller.enqueue({ type: "text-delta", id: "text-1", delta: nextText })
                }
              }
              if (textStarted) {
                controller.enqueue({ type: "text-end", id: "text-1" })
              }
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: emptyUsage(),
              })
              controller.close()
            } catch (error) {
              controller.error(error)
            }
          },
        })
        return { stream }
      }

      // Fallback to runPrompt (non-streaming)
      const generated = await createCursorLanguageModel(options).doGenerate(call)
      const textPart = generated.content.at(0)
      const text = textPart !== undefined && textPart.type === "text" ? textPart.text : ""
      const stream = new ReadableStream({
        start(controller): void {
          controller.enqueue({ type: "stream-start", warnings: [] })
          controller.enqueue({ type: "text-start", id: "text-1" })
          controller.enqueue({ type: "text-delta", id: "text-1", delta: text })
          controller.enqueue({ type: "text-end", id: "text-1" })
          controller.enqueue({
            type: "finish",
            finishReason: generated.finishReason,
            usage: generated.usage,
          })
          controller.close()
        },
      })
      return { stream }
    },
  }
}
