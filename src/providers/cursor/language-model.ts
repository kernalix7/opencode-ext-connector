// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors"
import { parseProviderId } from "../../core/ids"

export type CursorLanguageModelOptions = {
  readonly modelId: string
  readonly runPrompt: (prompt: string, signal: AbortSignal) => Promise<string | null>
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

function promptText(prompt: LanguageModelV3CallOptions["prompt"]): string {
  const parts: string[] = []
  for (const message of prompt) {
    switch (message.role) {
      case "system":
        parts.push(message.content)
        break
      case "user":
      case "assistant":
        parts.push(textFromContentParts(message.content))
        break
      case "tool":
        break
    }
  }
  return parts.join("\n")
}

function emptyUsage(): {
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

export function createCursorLanguageModel(options: CursorLanguageModelOptions): LanguageModelV3 {
  const provider = parseProviderId("cursor")
  return {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async (call: LanguageModelV3CallOptions) => {
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("cursor-generate")
      }
      const text = await options.runPrompt(promptText(call.prompt), signal)
      if (text === null) {
        throw new AdapterError({
          operation: "cursor-agent-unavailable",
          retryable: false,
          cause: null,
          providerId: provider,
        })
      }
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: emptyUsage(),
        warnings: [],
      }
    },
    doStream: async (call: LanguageModelV3CallOptions) => {
      const generated = await createCursorLanguageModel(options).doGenerate(call)
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
