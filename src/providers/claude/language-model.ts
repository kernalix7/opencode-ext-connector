// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors"
import type { HttpTransport } from "../../core/http"
import { parseProviderId } from "../../core/ids"

const CLAUDE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

export type ClaudeLanguageModelOptions = {
  readonly modelId: string
  readonly transport: HttpTransport
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
}

function textFromContentParts(parts: readonly { readonly type: string }[]): string {
  const texts: string[] = []
  for (const part of parts) {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      texts.push(part.text)
    }
  }
  return texts.join("")
}

function textFromPrompt(prompt: LanguageModelV3CallOptions["prompt"]): {
  readonly system: string
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[]
} {
  const messages: { role: "user" | "assistant"; content: string }[] = []
  const systems: string[] = [CLAUDE_IDENTITY]
  for (const message of prompt) {
    switch (message.role) {
      case "system":
        systems.push(message.content)
        break
      case "user":
        messages.push({
          role: "user",
          content: textFromContentParts(message.content),
        })
        break
      case "assistant":
        messages.push({
          role: "assistant",
          content: textFromContentParts(message.content),
        })
        break
      case "tool":
        break
    }
  }
  return { system: systems.join("\n"), messages }
}

function parseAssistantText(body: Uint8Array): string {
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

export function createClaudeLanguageModel(options: ClaudeLanguageModelOptions): LanguageModelV3 {
  const provider = parseProviderId("claude")
  return {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async (call: LanguageModelV3CallOptions) => {
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("claude-generate")
      }
      const token = await options.readAccessToken(signal)
      if (token === null) {
        throw new AdapterError({
          operation: "claude-missing-credentials",
          retryable: false,
          cause: null,
          providerId: provider,
        })
      }
      const mapped = textFromPrompt(call.prompt)
      const response = await options.transport.request(
        {
          method: "POST",
          url: "https://api.anthropic.com/v1/messages",
          headers: {
            "anthropic-version": "2023-06-01",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "user-agent": "claude-cli/2.1.6 (external, sdk-cli)",
          },
          body: new TextEncoder().encode(
            JSON.stringify({
              model: options.modelId,
              max_tokens: call.maxOutputTokens ?? 4096,
              system: mapped.system,
              messages: mapped.messages,
            }),
          ),
        },
        signal,
      )
      if (response.status >= 400) {
        throw new AdapterError({
          operation: "claude-http",
          retryable: response.status >= 500,
          cause: null,
          providerId: provider,
        })
      }
      const text = parseAssistantText(response.body)
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: {
            total: undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
        warnings: [],
      }
    },
    doStream: async (call: LanguageModelV3CallOptions) => {
      const generated = await createClaudeLanguageModel(options).doGenerate(call)
      const textPart = generated.content.at(0)
      const text = textPart !== undefined && textPart.type === "text" ? textPart.text : ""
      const stream = new ReadableStream({
        start(controller): void {
          controller.enqueue({ type: "stream-start", warnings: [] })
          controller.enqueue({ type: "text-start", id: "text-1" })
          controller.enqueue({ type: "text-delta", id: "text-1", delta: text })
          controller.enqueue({ type: "text-end", id: "text-1" })
          controller.enqueue({
            type: "finish",
            finishReason: generated.finishReason,
            usage: generated.usage,
          })
          controller.close()
        },
      })
      return { stream }
    },
  }
}
