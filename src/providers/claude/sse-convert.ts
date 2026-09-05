// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { AnthropicSseEvent, SseParseResult } from "./sse.js"

export function convertEventToPart(event: AnthropicSseEvent): SseParseResult | null {
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
