// Derived from brent-weatherall/opencode-commandcode-provider@6cf3f22d4aae469db3723e589291c736285373c1 src/stream.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"
import { z } from "zod"

import { commandCodeNdjsonError } from "./errors"
import { commandCodeRecords } from "./record-stream"

const tokenDetailsSchema = z
  .object({
    noCacheTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    textTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
  })
  .passthrough()

const usageSchema = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    inputTokenDetails: tokenDetailsSchema.optional(),
    outputTokenDetails: tokenDetailsSchema.optional(),
  })
  .passthrough()

const providerErrorSchema = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    isRetryable: z.boolean().optional(),
  })
  .passthrough()
  .transform((error) => ({
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
    ...(error.isRetryable === undefined ? {} : { isRetryable: error.isRetryable }),
  }))

const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).passthrough(),
  z.object({ type: z.literal("abort") }).passthrough(),
  z
    .object({
      type: z.enum([
        "text-start",
        "text-end",
        "reasoning-start",
        "reasoning-end",
        "tool-input-end",
      ]),
      id: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.enum(["text-delta", "reasoning-delta", "tool-input-delta"]),
      id: z.string().optional(),
      text: z.string().optional(),
      delta: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("tool-input-start"),
      id: z.string().optional(),
      toolName: z.string().optional(),
      dynamic: z.boolean().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("tool-call"),
      toolCallId: z.string().optional(),
      id: z.string().optional(),
      toolName: z.string().optional(),
      input: z.unknown().optional(),
      args: z.unknown().optional(),
      arguments: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("finish-step"),
      finishReason: z.string().optional(),
      usage: usageSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("finish"),
      finishReason: z.string().optional(),
      rawFinishReason: z.string().optional(),
      totalUsage: usageSchema.optional(),
      usage: usageSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("response-metadata"),
      id: z.string().optional(),
      modelId: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("error"),
      error: z.union([z.string(), providerErrorSchema]).optional(),
      message: z.string().optional(),
    })
    .passthrough(),
])

type StreamEvent = z.infer<typeof streamEventSchema>

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

function usageFromEvent(event: Extract<StreamEvent, { type: "finish" }>): LanguageModelV3Usage {
  const usage = event.totalUsage ?? event.usage
  return {
    inputTokens: {
      total: usage?.inputTokens,
      noCache: usage?.inputTokenDetails?.noCacheTokens,
      cacheRead: usage?.inputTokenDetails?.cacheReadTokens,
      cacheWrite: usage?.inputTokenDetails?.cacheWriteTokens,
    },
    outputTokens: {
      total: usage?.outputTokens,
      text: usage?.outputTokenDetails?.textTokens,
      reasoning: usage?.outputTokenDetails?.reasoningTokens,
    },
  }
}

function toolCallPart(
  event: Extract<StreamEvent, { type: "tool-call" }>,
): LanguageModelV3StreamPart {
  const input = event.input ?? event.args ?? event.arguments ?? {}
  return {
    type: "tool-call",
    toolCallId: event.toolCallId ?? event.id ?? "",
    toolName: event.toolName ?? "",
    input: typeof input === "string" ? input : JSON.stringify(input),
  }
}

function streamPart(event: StreamEvent): LanguageModelV3StreamPart | null {
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
    case "tool-call":
      return toolCallPart(event)
    case "finish": {
      const raw = event.rawFinishReason ?? event.finishReason ?? "stop"
      return { type: "finish", finishReason: finishReason(raw), usage: usageFromEvent(event) }
    }
    case "response-metadata":
      return {
        type: event.type,
        ...(event.id === undefined ? {} : { id: event.id }),
        ...(event.modelId === undefined ? {} : { modelId: event.modelId }),
      }
    case "error":
      return { type: "error", error: commandCodeNdjsonError(event.error) }
  }
}

function parseEvent(line: string): StreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(line)
    const result = streamEventSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export async function emitCommandCodeChunks(
  chunks: AsyncIterable<Uint8Array>,
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
): Promise<void> {
  let finished = false
  const consumeLine = (line: string): void => {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith(":") || trimmed === "[DONE]") {
      return
    }
    const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trimStart() : trimmed
    const event = parseEvent(payload)
    if (event === null || (event.type === "finish" && finished)) {
      return
    }
    const part = streamPart(event)
    if (part !== null) {
      controller.enqueue(part)
    }
    if (event.type === "finish") {
      finished = true
    }
  }
  for await (const line of commandCodeRecords(chunks)) consumeLine(line)
}
