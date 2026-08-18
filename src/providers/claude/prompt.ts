// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
} from "@ai-sdk/provider"

import { type RequestBody, repairOrphanToolUses } from "./transform"

const CLAUDE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

type AnthropicContentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use"
      readonly id: string
      readonly name: string
      readonly input: Record<string, unknown>
    }
  | {
      readonly type: "tool_result"
      readonly tool_use_id: string
      readonly content: string
      readonly is_error: boolean
    }

type PromptContentPart =
  | LanguageModelV3TextPart
  | LanguageModelV3ToolCallPart
  | LanguageModelV3ToolResultPart

function isTextPart(part: unknown): part is LanguageModelV3TextPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    Reflect.get(part, "type") === "text"
  )
}

function isToolCallPart(part: unknown): part is LanguageModelV3ToolCallPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    Reflect.get(part, "type") === "tool-call"
  )
}

function isToolResultPart(part: unknown): part is LanguageModelV3ToolResultPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    Reflect.get(part, "type") === "tool-result"
  )
}

function toolResultOutputToString(output: LanguageModelV3ToolResultOutput): string {
  if (output.type === "text") {
    return output.value
  }
  return JSON.stringify(output)
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      result[key] = Reflect.get(value, key)
    }
    return result
  }
  return {}
}

function contentPartToAnthropic(part: PromptContentPart): AnthropicContentPart {
  if (isTextPart(part)) {
    return { type: "text", text: part.text }
  }
  if (isToolCallPart(part)) {
    return {
      type: "tool_use",
      id: part.toolCallId,
      name: part.toolName,
      input: toRecord(part.input),
    }
  }
  if (isToolResultPart(part)) {
    return {
      type: "tool_result",
      tool_use_id: part.toolCallId,
      content: toolResultOutputToString(part.output),
      is_error: false,
    }
  }
  return { type: "text", text: "" }
}

export function promptToAnthropicMessages(prompt: LanguageModelV3CallOptions["prompt"]): {
  readonly system: string
  readonly messages: readonly {
    readonly role: "user" | "assistant"
    readonly content: readonly AnthropicContentPart[]
  }[]
} {
  const messages: { role: "user" | "assistant"; content: AnthropicContentPart[] }[] = []
  const systems: string[] = [CLAUDE_IDENTITY]
  for (const message of prompt) {
    switch (message.role) {
      case "system":
        systems.push(message.content)
        break
      case "user": {
        const content: AnthropicContentPart[] = []
        for (const part of message.content) {
          if (isTextPart(part) || isToolCallPart(part) || isToolResultPart(part)) {
            content.push(contentPartToAnthropic(part))
          }
        }
        messages.push({ role: "user", content })
        break
      }
      case "assistant": {
        const content: AnthropicContentPart[] = []
        for (const part of message.content) {
          if (isTextPart(part) || isToolCallPart(part) || isToolResultPart(part)) {
            content.push(contentPartToAnthropic(part))
          }
        }
        messages.push({ role: "assistant", content })
        break
      }
      case "tool":
        break
    }
  }
  return { system: systems.join("\n"), messages }
}

export function buildRequestBody(
  options: { readonly modelId: string; readonly maxOutputTokens?: number },
  mapped: ReturnType<typeof promptToAnthropicMessages>,
  stream: boolean,
): RequestBody {
  const baseBody: RequestBody = {
    model: options.modelId,
    max_tokens: options.maxOutputTokens ?? 4096,
    system: mapped.system,
    messages: mapped.messages,
  }
  const requestBody = stream ? { ...baseBody, stream: true } : baseBody
  return repairOrphanToolUses(requestBody)
}

export function parseAssistantText(body: Uint8Array): string {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
  if (typeof parsed !== "object" || parsed === null || !("content" in parsed)) {
    return ""
  }
  const content = parsed.content
  if (!Array.isArray(content)) {
    return ""
  }
  const texts: string[] = []
  for (const part of content) {
    if (typeof part === "object" && part !== null && "type" in part && "text" in part) {
      if (part.type === "text" && typeof part.text === "string") {
        texts.push(part.text)
      }
    }
  }
  return texts.join("")
}

export function emptyUsage(): {
  readonly inputTokens: {
    readonly total: undefined
    readonly noCache: undefined
    readonly cacheRead: undefined
    readonly cacheWrite: undefined
  }
  readonly outputTokens: {
    readonly total: undefined
    readonly text: undefined
    readonly reasoning: undefined
  }
} {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  }
}
