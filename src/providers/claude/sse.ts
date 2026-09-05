// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

import { convertEventToPart } from "./sse-convert.js"

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

export type SseParseState = {
  readonly buffer: string
  readonly event: string | null
}

export function createSseParseState(): SseParseState {
  return { buffer: "", event: null }
}

export function parseAnthropicSse(
  chunk: Uint8Array,
  state: SseParseState,
): { readonly events: readonly SseParseResult[]; readonly state: SseParseState } {
  const text = new TextDecoder().decode(chunk)
  const combined = state.buffer + text
  const lines = combined.split("\n")
  const newBuffer = lines.pop() ?? ""
  const events: SseParseResult[] = []
  let currentEvent: string | undefined = state.event ?? undefined
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

  return {
    events,
    state: { buffer: newBuffer, event: currentEvent ?? null },
  }
}

export { convertEventToPart, mapStopReason } from "./sse-convert.js"
