import type {
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider"

import { OllamaGenerationError } from "./errors.js"
import { parseOllamaNdjson } from "./ndjson.js"
import { type OllamaChatChunk, OllamaChatChunkSchema } from "./protocol.js"

function usage(chunk: OllamaChatChunk): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: chunk.prompt_eval_count,
      noCache: chunk.prompt_eval_count,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: chunk.eval_count, text: chunk.eval_count, reasoning: undefined },
  }
}

function finishReason(raw: string | undefined, toolCalls: boolean): LanguageModelV3FinishReason {
  if (toolCalls) return { unified: "tool-calls", raw }
  switch (raw) {
    case "stop":
    case undefined:
      return { unified: "stop", raw }
    case "length":
      return { unified: "length", raw }
    case "content_filter":
      return { unified: "content-filter", raw }
    default:
      return { unified: "other", raw }
  }
}

export function createOllamaChatStream(options: {
  readonly response: Response
  readonly warnings: SharedV3Warning[]
  readonly includeRawChunks: boolean
  readonly cancel: () => void
  readonly finalize: () => void
}): ReadableStream<LanguageModelV3StreamPart> {
  let cancelled = false
  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller): Promise<void> {
      let textOpen = false
      let reasoningOpen = false
      let toolIndex = 0
      let hadToolCalls = false
      let terminal = false
      const closeSections = (): void => {
        if (reasoningOpen) controller.enqueue({ type: "reasoning-end", id: "reasoning-1" })
        if (textOpen) controller.enqueue({ type: "text-end", id: "text-1" })
        reasoningOpen = false
        textOpen = false
      }
      controller.enqueue({ type: "stream-start", warnings: options.warnings })
      try {
        for await (const chunk of parseOllamaNdjson(
          options.response,
          OllamaChatChunkSchema,
          "chat-response",
        )) {
          if (options.includeRawChunks) controller.enqueue({ type: "raw", rawValue: chunk })
          if (chunk.message.thinking !== undefined && chunk.message.thinking.length > 0) {
            if (!reasoningOpen) controller.enqueue({ type: "reasoning-start", id: "reasoning-1" })
            reasoningOpen = true
            controller.enqueue({
              type: "reasoning-delta",
              id: "reasoning-1",
              delta: chunk.message.thinking,
            })
          }
          if (chunk.message.content.length > 0) {
            if (!textOpen) controller.enqueue({ type: "text-start", id: "text-1" })
            textOpen = true
            controller.enqueue({ type: "text-delta", id: "text-1", delta: chunk.message.content })
          }
          for (const call of chunk.message.tool_calls ?? []) {
            toolIndex += 1
            hadToolCalls = true
            controller.enqueue({
              type: "tool-call",
              toolCallId: `ollama-tool-${toolIndex}`,
              toolName: call.function.name,
              input: JSON.stringify(call.function.arguments),
            })
          }
          if (chunk.done && !terminal) {
            terminal = true
            closeSections()
            controller.enqueue({
              type: "finish",
              finishReason: finishReason(chunk.done_reason, hadToolCalls),
              usage: usage(chunk),
            })
          }
        }
        if (!terminal) throw new OllamaGenerationError("chat-response")
        if (!cancelled) controller.close()
      } catch (error) {
        if (!cancelled) {
          closeSections()
          controller.enqueue({ type: "error", error })
          controller.close()
        }
      } finally {
        options.finalize()
      }
    },
    cancel(): void {
      cancelled = true
      options.cancel()
      options.finalize()
    },
  })
}
