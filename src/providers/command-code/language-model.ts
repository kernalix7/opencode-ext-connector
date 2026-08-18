// Derived from thaolaptrinh/commandcode-api-proxy@f4b3390e2f18a42bc164a1a94a4d796e20d19700.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors"
import type { HttpTransport } from "../../core/http"
import { parseProviderId } from "../../core/ids"

export type CommandCodeLanguageModelOptions = {
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

function promptMessages(
  prompt: LanguageModelV3CallOptions["prompt"],
): readonly { readonly role: string; readonly content: string }[] {
  const messages: { role: string; content: string }[] = []
  for (const message of prompt) {
    switch (message.role) {
      case "system":
        messages.push({ role: "system", content: message.content })
        break
      case "user":
      case "assistant":
        messages.push({
          role: message.role,
          content: textFromContentParts(message.content),
        })
        break
      case "tool":
        break
    }
  }
  return messages
}

function parseNdjsonText(body: Uint8Array): string {
  const texts: string[] = []
  for (const line of new TextDecoder().decode(body).split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed === "[DONE]") {
      continue
    }
    const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed
    if (payload.length === 0 || payload === "[DONE]") {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue
    }
    if ("text" in parsed && typeof parsed.text === "string") {
      texts.push(parsed.text)
      continue
    }
    if ("data" in parsed && typeof parsed.data === "object" && parsed.data !== null) {
      const nested = parsed.data
      if ("text" in nested && typeof nested.text === "string") {
        texts.push(nested.text)
      }
    }
  }
  return texts.join("")
}

export function createCommandCodeLanguageModel(
  options: CommandCodeLanguageModelOptions,
): LanguageModelV3 {
  const provider = parseProviderId("command-code")
  return {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async (call: LanguageModelV3CallOptions) => {
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("command-code-generate")
      }
      const token = await options.readAccessToken(signal)
      if (token === null) {
        throw new AdapterError({
          operation: "command-code-missing-credentials",
          retryable: false,
          cause: null,
          providerId: provider,
        })
      }
      const response = await options.transport.request(
        {
          method: "POST",
          url: "https://api.commandcode.ai/alpha/generate",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "user-agent": "commandcode-cli/0.1.0",
            "x-command-code-version": "0.1.0",
          },
          body: new TextEncoder().encode(
            JSON.stringify({
              stream: true,
              params: {
                model: options.modelId,
                messages: promptMessages(call.prompt),
              },
            }),
          ),
        },
        signal,
      )
      if (response.status >= 400) {
        throw new AdapterError({
          operation: "command-code-http",
          retryable: response.status >= 500,
          cause: null,
          providerId: provider,
        })
      }
      return {
        content: [{ type: "text", text: parseNdjsonText(response.body) }],
        finishReason: { unified: "stop", raw: "stop" },
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
      const generated = await createCommandCodeLanguageModel(options).doGenerate(call)
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
