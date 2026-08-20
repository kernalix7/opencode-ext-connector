// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors"
import { parseProviderId } from "../../core/ids"
import { cursorResultError, cursorTextFromUnknown } from "./ndjson"
import { cursorIncrementalPrompt, cursorPromptText, cursorSessionKey } from "./prompt"
import { cursorToolParts } from "./tool-stream"
import { cursorUsage, emptyCursorUsage } from "./usage"

export type CursorLanguageModelOptions = {
  readonly modelId: string
  readonly runPrompt: (prompt: string, signal: AbortSignal) => Promise<string | null>
  readonly streamNdjson?: (
    prompt: string,
    signal: AbortSignal,
    sessionKey: string | null,
    incrementalPrompt: string | null,
  ) => AsyncIterable<string>
}

export function createCursorLanguageModel(options: CursorLanguageModelOptions): LanguageModelV3 {
  const provider = parseProviderId("cursor")
  const model: LanguageModelV3 = {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async (call: LanguageModelV3CallOptions) => {
      if (options.streamNdjson !== undefined) {
        const streamed = await model.doStream(call)
        const content: LanguageModelV3Content[] = []
        const text: string[] = []
        const reasoning: string[] = []
        let finishReason: LanguageModelV3FinishReason = { unified: "stop", raw: "stop" }
        let usage: LanguageModelV3Usage = emptyCursorUsage()
        for await (const part of streamed.stream) {
          if (part.type === "text-delta") {
            text.push(part.delta)
          } else if (part.type === "reasoning-delta") {
            reasoning.push(part.delta)
          } else if (part.type === "tool-call") {
            content.push({
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            })
          } else if (part.type === "finish") {
            finishReason = part.finishReason
            usage = part.usage
          } else if (part.type === "error") {
            throw part.error
          }
        }
        const joined = text.join("")
        if (joined.length > 0) {
          content.unshift({ type: "text", text: joined })
        }
        const joinedReasoning = reasoning.join("")
        if (joinedReasoning.length > 0) {
          content.unshift({ type: "reasoning", text: joinedReasoning })
        }
        return { content, finishReason, usage, warnings: [] }
      }
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("cursor-generate")
      }
      const text = await options.runPrompt(cursorPromptText(call), signal)
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
        usage: emptyCursorUsage(),
        warnings: [],
      }
    },
    doStream: async (call: LanguageModelV3CallOptions) => {
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("cursor-stream")
      }
      const prompt = cursorPromptText(call)
      const allowedTools = new Map<string, unknown>(
        (call.tools ?? [])
          .filter((tool) => tool.type === "function")
          .map((tool) => [tool.name, tool.inputSchema]),
      )

      const streamNdjson = options.streamNdjson
      if (streamNdjson !== undefined) {
        const stream = new ReadableStream({
          async start(controller) {
            try {
              let started = false
              let textStarted = false
              let reasoningStarted = false
              let reasoningText = ""
              let assistantText = ""
              let toolCalled = false
              let usage: LanguageModelV3Usage = emptyCursorUsage()
              streamLoop: for await (const line of streamNdjson(
                prompt,
                signal,
                cursorSessionKey(call),
                cursorIncrementalPrompt(call),
              )) {
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
                if (!started) {
                  controller.enqueue({ type: "stream-start", warnings: [] })
                  started = true
                }
                if (type === "thinking") {
                  const text = cursorTextFromUnknown(parsed) ?? ""
                  const delta = text.startsWith(reasoningText)
                    ? text.slice(reasoningText.length)
                    : text
                  reasoningText = text.startsWith(reasoningText) ? text : reasoningText + text
                  if (delta.length > 0) {
                    if (!reasoningStarted) {
                      controller.enqueue({ type: "reasoning-start", id: "reasoning-1" })
                      reasoningStarted = true
                    }
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: "reasoning-1",
                      delta,
                    })
                  }
                  continue
                }
                if (reasoningStarted) {
                  controller.enqueue({ type: "reasoning-end", id: "reasoning-1" })
                  reasoningStarted = false
                }
                const toolParts = cursorToolParts(parsed, allowedTools)
                for (const part of toolParts) {
                  controller.enqueue(part)
                  if (part.type === "tool-call" && part.providerExecuted !== true) {
                    toolCalled = true
                    break streamLoop
                  }
                }
                if (
                  type !== "assistant" &&
                  type !== "text" &&
                  type !== "text-delta" &&
                  type !== "result"
                ) {
                  continue
                }
                const text = cursorTextFromUnknown(parsed) ?? ""
                let nextText = text
                if (type === "assistant") {
                  if (text === assistantText) {
                    nextText = ""
                  } else if (text.startsWith(assistantText)) {
                    nextText = text.slice(assistantText.length)
                    assistantText = text
                  } else {
                    assistantText += text
                  }
                } else if (type === "result") {
                  const resultError = cursorResultError(parsed)
                  if (resultError !== null) {
                    throw resultError
                  }
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
              if (signal.aborted) {
                throw new OperationCancelledError("cursor-stream")
              }
              if (reasoningStarted) {
                controller.enqueue({ type: "reasoning-end", id: "reasoning-1" })
              }
              if (textStarted) {
                controller.enqueue({ type: "text-end", id: "text-1" })
              }
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
  return model
}
