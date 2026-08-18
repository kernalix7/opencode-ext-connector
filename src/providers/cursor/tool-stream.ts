// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

function stringField(value: object, key: string): string | null {
  if (!(key in value)) {
    return null
  }
  const field = Reflect.get(value, key)
  return typeof field === "string" && field.length > 0 ? field : null
}

function toolNameFromKey(key: string): string {
  return key.endsWith("ToolCall") ? key.slice(0, -"ToolCall".length) : key
}

function nestedToolCall(value: object): { readonly name: string; readonly args: unknown } | null {
  if (!("tool_call" in value)) {
    return null
  }
  const payload = Reflect.get(value, "tool_call")
  if (typeof payload !== "object" || payload === null) {
    return null
  }
  const entries = Object.entries(payload)
  const first = entries.at(0)
  if (first === undefined) {
    return null
  }
  const [key, nested] = first
  if (typeof nested !== "object" || nested === null) {
    return { name: toolNameFromKey(key), args: {} }
  }
  const args = "args" in nested ? Reflect.get(nested, "args") : nested
  return { name: toolNameFromKey(key), args }
}

export function cursorToolParts(parsed: object): readonly LanguageModelV3StreamPart[] {
  const type = stringField(parsed, "type")
  if (type !== "tool_call") {
    return []
  }
  const subtype = stringField(parsed, "subtype") ?? "started"
  const id = stringField(parsed, "call_id") ?? stringField(parsed, "id") ?? "tool-1"
  const flatName = stringField(parsed, "name") ?? stringField(parsed, "toolName")
  const nested = nestedToolCall(parsed)
  const toolName = flatName ?? nested?.name ?? "unknown"
  const args = "arguments" in parsed ? Reflect.get(parsed, "arguments") : nested?.args
  const input = JSON.stringify(args ?? {})
  if (subtype === "delta") {
    return [{ type: "tool-input-delta", id, delta: input }]
  }
  if (subtype === "completed") {
    return [{ type: "tool-input-end", id }]
  }
  return [
    { type: "tool-input-start", id, toolName },
    { type: "tool-input-delta", id, delta: input },
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input },
  ]
}
