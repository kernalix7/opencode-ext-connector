import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"

import { OperationCancelledError } from "../../core/errors"
import { cursorResultError, cursorTextFromUnknown } from "./ndjson"
import { cursorIncrementalPrompt, cursorPromptText, cursorSessionKey } from "./prompt"
import { cursorToolParts } from "./tool-stream"
import { cursorUsage, emptyCursorUsage } from "./usage"

export type CursorNdjsonStream = (
  prompt: string,
  signal: AbortSignal,
  sessionKey: string | null,
  incrementalPrompt: string | null,
  tools?: readonly {
    readonly name: string
    readonly description?: string
    readonly inputSchema: unknown
  }[],
) => AsyncIterable<string>

export function createCursorLegacyStream(options: {
  readonly call: LanguageModelV3CallOptions
  readonly signal: AbortSignal
  readonly streamNdjson: CursorNdjsonStream
}): ReadableStream<LanguageModelV3StreamPart> {
  const allowedTools = new Map<string, unknown>(
    (options.call.tools ?? [])
      .filter((tool) => tool.type === "function")
      .map((tool) => [tool.name, tool.inputSchema]),
  )
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue({ type: "stream-start", warnings: [] })
        let textStarted = false
        let reasoningStarted = false
        let reasoningText = ""
        let assistantText = ""
        let toolCalled = false
        let usage: LanguageModelV3Usage = emptyCursorUsage()
        streamLoop: for await (const line of options.streamNdjson(
          cursorPromptText(options.call),
          options.signal,
          cursorSessionKey(options.call),
          cursorIncrementalPrompt(options.call),
          (options.call.tools ?? [])
            .filter((tool) => tool.type === "function")
            .map((tool) => ({
              name: tool.name,
              ...(tool.description === undefined ? {} : { description: tool.description }),
              inputSchema: tool.inputSchema,
            })),
        )) {
          if (options.signal.aborted) throw new OperationCancelledError("cursor-stream")
          const trimmed = line.trim()
          if (trimmed.length === 0) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(trimmed)
          } catch {
            continue
          }
          if (typeof parsed !== "object" || parsed === null) continue
          const type = "type" in parsed && typeof parsed.type === "string" ? parsed.type : ""
          if (type === "thinking") {
            const text = cursorTextFromUnknown(parsed) ?? ""
            const delta = text.startsWith(reasoningText) ? text.slice(reasoningText.length) : text
            reasoningText = text.startsWith(reasoningText) ? text : reasoningText + text
            if (delta.length > 0) {
              if (!reasoningStarted) {
                controller.enqueue({ type: "reasoning-start", id: "reasoning-1" })
                reasoningStarted = true
              }
              controller.enqueue({ type: "reasoning-delta", id: "reasoning-1", delta })
            }
            continue
          }
          if (reasoningStarted) {
            controller.enqueue({ type: "reasoning-end", id: "reasoning-1" })
            reasoningStarted = false
          }
          for (const part of cursorToolParts(parsed, allowedTools)) {
            controller.enqueue(part)
            if (part.type === "tool-call" && part.providerExecuted !== true) {
              toolCalled = true
              break streamLoop
            }
          }
          if (!["assistant", "text", "text-delta", "result"].includes(type)) continue
          const text = cursorTextFromUnknown(parsed) ?? ""
          let nextText = text
          if (type === "assistant") {
            if (text === assistantText) nextText = ""
            else if (text.startsWith(assistantText)) {
              nextText = text.slice(assistantText.length)
              assistantText = text
            } else assistantText += text
          } else if (type === "result") {
            const resultError = cursorResultError(parsed)
            if (resultError !== null) throw resultError
            nextText = assistantText.length > 0 ? "" : text
            usage = cursorUsage(parsed) ?? usage
          }
          if (nextText.length > 0) {
            if (!textStarted) {
              controller.enqueue({ type: "text-start", id: "text-1" })
              textStarted = true
            }
            controller.enqueue({ type: "text-delta", id: "text-1", delta: nextText })
          }
        }
        if (options.signal.aborted) throw new OperationCancelledError("cursor-stream")
        if (reasoningStarted) controller.enqueue({ type: "reasoning-end", id: "reasoning-1" })
        if (textStarted) controller.enqueue({ type: "text-end", id: "text-1" })
        controller.enqueue({
          type: "finish",
          finishReason: toolCalled
            ? { unified: "tool-calls", raw: "tool_calls" }
            : { unified: "stop", raw: "stop" },
          usage,
        })
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
