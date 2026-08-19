// Derived from thaolaptrinh/commandcode-api-proxy@f4b3390e2f18a42bc164a1a94a4d796e20d19700.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

function stringField(value: object, key: string): string | null {
  if (!(key in value)) {
    return null
  }
  const field = Reflect.get(value, key)
  return typeof field === "string" && field.length > 0 ? field : null
}

function objectField(value: object, key: string): object | null {
  if (!(key in value)) {
    return null
  }
  const field = Reflect.get(value, key)
  return typeof field === "object" && field !== null ? field : null
}

function toolPayload(parsed: object): {
  readonly toolCallId: string
  readonly toolName: string | null
  readonly argumentsText: string | null
  readonly input: unknown
} {
  const data = objectField(parsed, "data")
  const source = data ?? parsed
  return {
    toolCallId: stringField(source, "toolCallId") ?? stringField(parsed, "toolCallId") ?? "tool-1",
    toolName: stringField(source, "toolName") ?? stringField(source, "name"),
    argumentsText: stringField(source, "arguments") ?? stringField(parsed, "arguments"),
    input: "input" in source ? Reflect.get(source, "input") : undefined,
  }
}

export function commandCodeToolParts(parsed: object): readonly LanguageModelV3StreamPart[] {
  const type = stringField(parsed, "type")
  if (type !== "tool-call-delta" && type !== "tool-call") {
    return []
  }
  const payload = toolPayload(parsed)
  const toolName = payload.toolName ?? "unknown"
  if (type === "tool-call-delta") {
    const parts: LanguageModelV3StreamPart[] = []
    if (payload.toolName !== null) {
      parts.push({ type: "tool-input-start", id: payload.toolCallId, toolName })
    }
    parts.push({
      type: "tool-input-delta",
      id: payload.toolCallId,
      delta: payload.argumentsText ?? "{}",
    })
    return parts
  }
  const input =
    payload.argumentsText !== null ? payload.argumentsText : JSON.stringify(payload.input ?? {})
  return [
    { type: "tool-input-end", id: payload.toolCallId },
    { type: "tool-call", toolCallId: payload.toolCallId, toolName, input },
  ]
}
