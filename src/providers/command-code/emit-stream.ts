// Derived from brent-weatherall/opencode-commandcode-provider@6cf3f22d4aae469db3723e589291c736285373c1 src/stream.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.
import type {
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"
import { z } from "zod"
import { commandCodeNdjsonError } from "./errors.js"
import { commandCodeRecords } from "./record-stream.js"

const details = z
  .object({
    noCacheTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    textTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
  })
  .passthrough()
const usage = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    inputTokenDetails: details.optional(),
    outputTokenDetails: details.optional(),
  })
  .passthrough()
const providerError = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    isRetryable: z.boolean().optional(),
  })
  .passthrough()
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("abort") }),
  z.object({
    type: z.enum(["text-start", "text-end", "reasoning-start", "reasoning-end", "tool-input-end"]),
    id: z.string().optional(),
  }),
  z.object({
    type: z.enum(["text-delta", "reasoning-delta", "tool-input-delta"]),
    id: z.string().optional(),
    text: z.string().optional(),
    delta: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool-input-start"),
    id: z.string().optional(),
    toolName: z.string().optional(),
    dynamic: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string().optional(),
    id: z.string().optional(),
    toolName: z.string().optional(),
    input: z.unknown().optional(),
    args: z.unknown().optional(),
    arguments: z.unknown().optional(),
  }),
  z.object({ type: z.literal("finish-step") }),
  z.object({
    type: z.literal("finish"),
    finishReason: z.string().optional(),
    rawFinishReason: z.string().optional(),
    totalUsage: usage.optional(),
    usage: usage.optional(),
  }),
  z.object({
    type: z.literal("response-metadata"),
    id: z.string().optional(),
    modelId: z.string().optional(),
  }),
  z.object({ type: z.literal("error"), error: z.union([z.string(), providerError]).optional() }),
])
type Event = z.infer<typeof eventSchema>

function finishReason(raw: string): LanguageModelV3FinishReason {
  switch (raw) {
    case "stop":
    case "end_turn":
      return { unified: "stop", raw }
    case "tool_calls":
    case "tool-calls":
    case "tool_use":
      return { unified: "tool-calls", raw }
    case "length":
    case "max_tokens":
    case "max-tokens":
    case "max_output_tokens":
      return { unified: "length", raw }
    case "content_filter":
      return { unified: "content-filter", raw }
    default:
      return { unified: "other", raw }
  }
}
function eventUsage(event: Extract<Event, { type: "finish" }>): LanguageModelV3Usage {
  const value = event.totalUsage ?? event.usage
  return {
    inputTokens: {
      total: value?.inputTokens,
      noCache: value?.inputTokenDetails?.noCacheTokens,
      cacheRead: value?.inputTokenDetails?.cacheReadTokens,
      cacheWrite: value?.inputTokenDetails?.cacheWriteTokens,
    },
    outputTokens: {
      total: value?.outputTokens,
      text: value?.outputTokenDetails?.textTokens,
      reasoning: value?.outputTokenDetails?.reasoningTokens,
    },
  }
}
function streamPart(event: Event): LanguageModelV3StreamPart | null {
  switch (event.type) {
    case "start":
      return { type: "stream-start", warnings: [] }
    case "abort":
    case "finish-step":
      return null
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
    case "tool-input-end":
      return { type: event.type, id: event.id ?? "" }
    case "text-delta":
    case "reasoning-delta":
    case "tool-input-delta":
      return { type: event.type, id: event.id ?? "", delta: event.text ?? event.delta ?? "" }
    case "tool-input-start":
      return {
        type: event.type,
        id: event.id ?? "",
        toolName: event.toolName ?? "",
        ...(event.dynamic === undefined ? {} : { dynamic: event.dynamic }),
      }
    case "tool-call": {
      const input = event.input ?? event.args ?? event.arguments ?? {}
      return {
        type: "tool-call",
        toolCallId: event.toolCallId ?? event.id ?? "",
        toolName: event.toolName ?? "",
        input: typeof input === "string" ? input : JSON.stringify(input),
      }
    }
    case "finish":
      return {
        type: "finish",
        finishReason: finishReason(event.rawFinishReason ?? event.finishReason ?? "stop"),
        usage: eventUsage(event),
      }
    case "response-metadata":
      return {
        type: event.type,
        ...(event.id === undefined ? {} : { id: event.id }),
        ...(event.modelId === undefined ? {} : { modelId: event.modelId }),
      }
    case "error":
      return { type: "error", error: commandCodeNdjsonError(event.error) }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

export async function emitCommandCodeChunks(
  chunks: AsyncIterable<Uint8Array>,
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
): Promise<void> {
  let finished = false
  for await (const line of commandCodeRecords(chunks)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith(":") || trimmed === "[DONE]") continue
    const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trimStart() : trimmed
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch (error) {
      if (error instanceof SyntaxError) continue
      throw error
    }
    const result = eventSchema.safeParse(parsed)
    if (!result.success || (result.data.type === "finish" && finished)) continue
    const part = streamPart(result.data)
    if (part !== null) controller.enqueue(part)
    if (result.data.type === "finish") finished = true
  }
}
