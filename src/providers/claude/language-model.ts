// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors"
import type { HttpTransport } from "../../core/http"
import { parseProviderId } from "../../core/ids"
import {
  buildRequestBody,
  emptyUsage,
  parseAssistantText,
  promptToAnthropicMessages,
} from "./prompt"
import { mapStopReason, parseAnthropicSse } from "./sse"

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

      const { events, buffer: remainingBuffer } = parseAnthropicSse(response.body, "")
      const allEvents = [...events]
      if (remainingBuffer.length > 0) {
        const { events: trailingEvents } = parseAnthropicSse(
          new TextEncoder().encode("\n"),
          remainingBuffer,
        )
        allEvents.push(...trailingEvents)
      }

      let finishReason: {
        unified: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other"
        raw: string
      } = {
        unified: "stop",
        raw: "end_turn",
      }
      let textBlockIndex = 0
      let toolBlockIndex = 0

      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] })
          try {
            for (const event of allEvents) {
              if (event.kind === "part") {
                const part = event.part
                if (part.type === "text-start") {
                  textBlockIndex += 1
                  controller.enqueue({ ...part, id: `text-${textBlockIndex}` })
                } else if (part.type === "text-delta") {
                  controller.enqueue({ ...part, id: `text-${textBlockIndex}` })
                } else if (part.type === "text-end") {
                  controller.enqueue({ ...part, id: `text-${textBlockIndex}` })
                } else if (part.type === "tool-input-start") {
                  toolBlockIndex += 1
                  controller.enqueue({ ...part, id: part.id })
                } else if (part.type === "tool-input-delta") {
                  controller.enqueue({ ...part, id: `tool-${toolBlockIndex}` })
                } else if (part.type === "tool-input-end") {
                  controller.enqueue({ ...part, id: `tool-${toolBlockIndex}` })
                } else {
                  controller.enqueue(part)
                }
              } else if (event.kind === "finish") {
                finishReason = mapStopReason(event.stopReason)
              } else if (event.kind === "error") {
                controller.error(event.error)
                return
              }
            }
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: emptyUsage(),
            })
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
