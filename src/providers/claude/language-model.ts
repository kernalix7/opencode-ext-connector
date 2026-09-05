// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import { parseProviderId } from "../../core/ids.js"
import { openHttpBody } from "../../http/read-body.js"
import { emitClaudeSseChunks } from "./emit-stream.js"
import {
  buildRequestBody,
  emptyUsage,
  parseAssistantText,
  promptToAnthropicMessages,
} from "./prompt.js"

export type ClaudeLanguageModelOptions = {
  readonly modelId: string
  readonly transport: HttpTransport
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
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
      const mapped = promptToAnthropicMessages(call.prompt)
      const requestBody = buildRequestBody(options, mapped, false)
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
          body: new TextEncoder().encode(JSON.stringify(requestBody)),
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
        usage: emptyUsage(),
        warnings: [],
      }
    },
    doStream: async (call: LanguageModelV3CallOptions) => {
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("claude-stream")
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
      const mapped = promptToAnthropicMessages(call.prompt)
      const requestBody = buildRequestBody(options, mapped, true)
      const opened = await openHttpBody(
        options.transport,
        {
          method: "POST",
          url: "https://api.anthropic.com/v1/messages",
          headers: {
            "anthropic-version": "2023-06-01",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "user-agent": "claude-cli/2.1.6 (external, sdk-cli)",
          },
          body: new TextEncoder().encode(JSON.stringify(requestBody)),
        },
        signal,
      )
      if (opened.status >= 400) {
        throw new AdapterError({
          operation: "claude-http",
          retryable: opened.status >= 500,
          cause: null,
          providerId: provider,
        })
      }
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          try {
            await emitClaudeSseChunks(opened.chunks, controller)
          } catch (error) {
            controller.error(error)
          } finally {
            controller.close()
          }
        },
      })
      return { stream }
    },
  }
}
