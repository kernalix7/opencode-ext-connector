// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

export type AnthropicSseEvent =
  | {
      readonly type: "message_start"
      readonly message: {
        readonly id: string
        readonly type: "message"
        readonly role: "assistant"
        readonly content: readonly unknown[]
        readonly model: string
        readonly stop_reason: null
        readonly stop_sequence: null
        readonly usage: { readonly input_tokens: number; readonly output_tokens: number }
      }
    }
  | {
      readonly type: "content_block_start"
      readonly index: number
      readonly content_block: {
        readonly type: "text" | "tool_use"
        readonly id?: string
        readonly name?: string
        readonly input?: Record<string, unknown>
      }
    }
  | {
      readonly type: "content_block_delta"
      readonly index: number
      readonly delta: {
        readonly type: "text_delta" | "input_json_delta"
        readonly text?: string
        readonly partial_json?: string
      }
    }
  | { readonly type: "content_block_stop"; readonly index: number }
  | {
      readonly type: "message_delta"
      readonly delta: {
        readonly stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null
        readonly stop_sequence: string | null
      }
    }
  | { readonly type: "message_stop" }
  | { readonly type: "error"; readonly error: { readonly type: string; readonly message: string } }

export type SseParseResult =
  | { readonly kind: "part"; readonly part: LanguageModelV3StreamPart }
  | {
      readonly kind: "finish"
      readonly stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null
    }
  | { readonly kind: "error"; readonly error: Error }

function isAnthropicSseEvent(value: unknown): value is AnthropicSseEvent {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const typeValue = Reflect.get(value, "type")
  if (typeof typeValue !== "string") {
    return false
  }
  const validTypes = [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
    "error",
  ]
  return validTypes.includes(typeValue)
}

type SseLine =
  | { readonly event: string; readonly data?: never }
  | { readonly event?: never; readonly data: string }

function parseSseLine(line: string): SseLine | null {
  if (line.length === 0) {
    return null
  }
  if (line.startsWith(":")) {
    return null
  }
  const colonIndex = line.indexOf(":")
  if (colonIndex === -1) {
    return { event: line }
  }
  const field = line.slice(0, colonIndex)
  const value = line.slice(colonIndex + 1).trimStart()
  if (field === "event") {
    return { event: value }
  }
  if (field === "data") {
    return { data: value }
  }
  return null
}

function parseEventType(event: string): AnthropicSseEvent["type"] | null {
  const validEvents: Record<string, AnthropicSseEvent["type"]> = {
    message_start: "message_start",
    content_block_start: "content_block_start",
    content_block_delta: "content_block_delta",
    content_block_stop: "content_block_stop",
    message_delta: "message_delta",
    message_stop: "message_stop",
    error: "error",
  }
  return validEvents[event] ?? null
}

export function parseAnthropicSse(
  chunk: Uint8Array,
  buffer: string,
): { readonly events: readonly SseParseResult[]; readonly buffer: string } {
  const text = new TextDecoder().decode(chunk)
  const combined = buffer + text
  const lines = combined.split("\n")
  const newBuffer = lines.pop() ?? ""
  const events: SseParseResult[] = []
  let currentEvent: string | undefined
  let currentData: string | undefined

  for (const line of lines) {
    const parsed = parseSseLine(line)
    if (parsed === null) {
      continue
    }
    if ("event" in parsed) {
      currentEvent = parsed.event
      currentData = undefined
      continue
    }
    if ("data" in parsed) {
      currentData = parsed.data
      if (currentEvent === undefined) {
        continue
      }
      const eventType = parseEventType(currentEvent)
      if (eventType === null) {
        currentEvent = undefined
        currentData = undefined
        continue
      }
      let event: AnthropicSseEvent
      try {
        const parsed = JSON.parse(currentData)
        if (isAnthropicSseEvent(parsed)) {
          event = parsed
        } else {
          currentEvent = undefined
          currentData = undefined
          continue
        }
      } catch {
        currentEvent = undefined
        currentData = undefined
        continue
      }
      if (event.type !== eventType) {
        currentEvent = undefined
        currentData = undefined
        continue
      }
      const result = convertEventToPart(event)
      if (result !== null) {
        events.push(result)
      }
      currentEvent = undefined
      currentData = undefined
    }
  }

  return { events, buffer: newBuffer }
}

function convertEventToPart(event: AnthropicSseEvent): SseParseResult | null {
  switch (event.type) {
    case "message_start": {
      return { kind: "part", part: { type: "stream-start", warnings: [] } }
    }
    case "content_block_start": {
      const block = event.content_block
      if (block.type === "text") {
        return { kind: "part", part: { type: "text-start", id: `text-${event.index}` } }
      }
      if (block.type === "tool_use" && block.id !== undefined && block.name !== undefined) {
        return {
          kind: "part",
          part: {
            type: "tool-input-start",
            id: block.id,
            toolName: block.name,
            providerExecuted: false,
            dynamic: false,
          },
        }
      }
      return null
    }
    case "content_block_delta": {
      const delta = event.delta
      if (delta.type === "text_delta" && delta.text !== undefined) {
        return {
          kind: "part",
          part: { type: "text-delta", id: `text-${event.index}`, delta: delta.text },
        }
      }
      if (delta.type === "input_json_delta" && delta.partial_json !== undefined) {
        return {
          kind: "part",
          part: { type: "tool-input-delta", id: `tool-${event.index}`, delta: delta.partial_json },
        }
      }
      return null
    }
    case "content_block_stop": {
      // We don't know if it was text or tool_use, but we can emit both ends
      // The caller will need to track which block type it was
      return { kind: "part", part: { type: "text-end", id: `text-${event.index}` } }
    }
    case "message_delta": {
      const stopReason = event.delta.stop_reason
      if (stopReason !== null) {
        return { kind: "finish", stopReason }
      }
      return null
    }
    case "message_stop": {
      return { kind: "finish", stopReason: "end_turn" }
    }
    case "error": {
      return { kind: "error", error: new Error(`Anthropic API error: ${event.error.message}`) }
    }
  }
}

export function mapStopReason(
  reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null,
): {
  unified: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other"
  raw: string
} {
  switch (reason) {
    case "end_turn":
      return { unified: "stop", raw: "end_turn" }
    case "max_tokens":
      return { unified: "length", raw: "max_tokens" }
    case "stop_sequence":
      return { unified: "stop", raw: "stop_sequence" }
    case "tool_use":
      return { unified: "tool-calls", raw: "tool_use" }
    default:
      return { unified: "other", raw: "unknown" }
  }
}
