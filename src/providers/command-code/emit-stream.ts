// Derived from brent-weatherall/opencode-commandcode-provider@6cf3f22d4aae469db3723e589291c736285373c1 src/stream.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"

function field(value: object, key: string): unknown {
  return key in value ? Reflect.get(value, key) : undefined
}

function stringField(value: object, key: string): string | undefined {
  const result = field(value, key)
  return typeof result === "string" ? result : undefined
}

function objectField(value: object, key: string): object | undefined {
  const result = field(value, key)
  return typeof result === "object" && result !== null ? result : undefined
}

function numberField(value: object, ...keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const result = field(value, key)
    if (typeof result === "number") {
      return result
    }
  }
  return undefined
}

function finishReason(raw: string): LanguageModelV3FinishReason {
  const unified: LanguageModelV3FinishReason["unified"] = (() => {
    switch (raw) {
      case "stop":
      case "end_turn":
        return "stop"
      case "tool_calls":
      case "tool-calls":
        return "tool-calls"
      case "length":
      case "max_tokens":
      case "max-tokens":
      case "max_output_tokens":
        return "length"
      case "content_filter":
        return "content-filter"
      default:
        return "other"
    }
  })()
  return { unified, raw }
}

function usageFromEvent(event: object): LanguageModelV3Usage {
  const usage = objectField(event, "usage") ?? objectField(event, "totalUsage") ?? {}
  const input =
    objectField(usage, "inputTokenDetails") ?? objectField(usage, "input_token_details") ?? {}
  const output =
    objectField(usage, "outputTokenDetails") ?? objectField(usage, "output_token_details") ?? {}
  return {
    inputTokens: {
      total: numberField(usage, "inputTokens", "prompt_tokens"),
      noCache: numberField(input, "noCacheTokens"),
      cacheRead: numberField(input, "cacheReadTokens"),
      cacheWrite: numberField(input, "cacheWriteTokens"),
    },
    outputTokens: {
      total: numberField(usage, "outputTokens", "completion_tokens"),
      text: numberField(output, "textTokens"),
      reasoning: numberField(output, "reasoningTokens"),
    },
  }
}

function toolCallPart(event: object): LanguageModelV3StreamPart {
  const input = field(event, "input") ?? field(event, "args") ?? field(event, "arguments")
  return {
    type: "tool-call",
    toolCallId: stringField(event, "toolCallId") ?? stringField(event, "id") ?? "",
    toolName: stringField(event, "toolName") ?? "",
    input: typeof input === "string" ? input : JSON.stringify(input ?? {}),
  }
}

function streamPart(event: object): LanguageModelV3StreamPart | null {
  const type = stringField(event, "type")
  const id = stringField(event, "id") ?? ""
  switch (type) {
    case "start":
      return { type: "stream-start", warnings: [] }
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
    case "tool-input-end":
      return { type, id }
    case "text-delta":
    case "reasoning-delta":
    case "tool-input-delta":
      return {
        type,
        id,
        delta: stringField(event, "text") ?? stringField(event, "delta") ?? "",
      }
    case "tool-input-start": {
      const dynamic = field(event, "dynamic")
      return {
        type,
        id,
        toolName: stringField(event, "toolName") ?? "",
        ...(typeof dynamic === "boolean" ? { dynamic } : {}),
      }
    }
    case "tool-call":
      return toolCallPart(event)
    case "finish-step": {
      const raw =
        stringField(event, "finishReason") ?? stringField(event, "rawFinishReason") ?? "stop"
      return { type: "finish", finishReason: finishReason(raw), usage: usageFromEvent(event) }
    }
    case "finish":
      return null
    case "response-metadata": {
      const responseId = stringField(event, "id")
      const modelId = stringField(event, "modelId")
      return {
        type,
        ...(responseId === undefined ? {} : { id: responseId }),
        ...(modelId === undefined ? {} : { modelId }),
      }
    }
    case "error":
      return { type, error: field(event, "error") ?? field(event, "message") ?? "Unknown error" }
    default:
      return null
  }
}

export async function emitCommandCodeChunks(
  chunks: AsyncIterable<Uint8Array>,
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
): Promise<void> {
  let buffer = ""
  const decoder = new TextDecoder()
  const consumeLine = (line: string): void => {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith(":") || trimmed === "[DONE]") {
      return
    }
    let payload = trimmed
    if (payload.startsWith("data: ")) {
      payload = payload.slice(6)
    } else if (payload.startsWith("data:")) {
      payload = payload.slice(5)
    }
    try {
      const parsed: unknown = JSON.parse(payload)
      if (typeof parsed === "object" && parsed !== null) {
        const part = streamPart(parsed)
        if (part !== null) {
          controller.enqueue(part)
        }
      }
    } catch {}
  }
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      consumeLine(line.endsWith("\r") ? line.slice(0, -1) : line)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim().length > 0) {
    consumeLine(buffer)
  }
}
