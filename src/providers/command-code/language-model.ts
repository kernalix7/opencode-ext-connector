// Derived from thaolaptrinh/commandcode-api-proxy@f4b3390e2f18a42bc164a1a94a4d796e20d19700.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors"
import type { HttpTransport } from "../../core/http"
import { parseProviderId } from "../../core/ids"
import { openHttpBody } from "../../http/read-body"
import { emitCommandCodeChunks } from "./emit-stream"
import { parseNdjsonStream } from "./ndjson"
import { type BuildBodyOptions, type BuildHeadersOptions, buildBody, buildHeaders } from "./request"

const CLI_VERSION = "0.1.0"

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

function buildRequestOptions(
  options: CommandCodeLanguageModelOptions,
  call: LanguageModelV3CallOptions,
  token: string,
): { readonly url: string; readonly headers: Record<string, string>; readonly body: Uint8Array } {
  const messages = promptMessages(call.prompt)
  const bodyOptions: BuildBodyOptions = {
    modelId: options.modelId,
    messages,
  }
  const headerOptions: BuildHeadersOptions = {
    token,
    cliVersion: CLI_VERSION,
  }
  return {
    url: "https://api.commandcode.ai/alpha/generate",
    headers: buildHeaders(headerOptions),
    body: new TextEncoder().encode(JSON.stringify(buildBody(bodyOptions))),
  }
}

function createUsage(): LanguageModelV3Usage {
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

function createFinishReason(): LanguageModelV3FinishReason {
  return { unified: "stop", raw: "stop" }
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
      const requestOptions = buildRequestOptions(options, call, token)
      const response = await options.transport.request(
        {
          method: "POST",
          url: requestOptions.url,
          headers: requestOptions.headers,
          body: requestOptions.body,
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
      const deltas = parseNdjsonStream(response.body)
      const text = deltas.map((d) => d.delta).join("")
      return {
        content: [{ type: "text", text }],
        finishReason: createFinishReason(),
        usage: createUsage(),
        warnings: [],
      }
    },
    doStream: async (call: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("command-code-stream")
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
      const requestOptions = buildRequestOptions(options, call, token)
      const opened = await openHttpBody(
        options.transport,
        {
          method: "POST",
          url: requestOptions.url,
          headers: requestOptions.headers,
          body: requestOptions.body,
        },
        signal,
      )
      if (opened.status >= 400) {
        throw new AdapterError({
          operation: "command-code-http",
          retryable: opened.status >= 500,
          cause: null,
          providerId: provider,
        })
      }
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller): Promise<void> {
          await emitCommandCodeChunks(opened.chunks, controller)
          controller.enqueue({
            type: "finish",
            finishReason: createFinishReason(),
            usage: createUsage(),
          })
          controller.close()
        },
      })
      return { stream }
    },
  }
}
