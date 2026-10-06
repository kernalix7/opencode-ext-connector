import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import { parseProviderId } from "../../core/ids.js"
import { createSdkFetch } from "../../http/sdk-fetch.js"
import { listCommandCodeCapabilities } from "./api-models.js"

export function createCommandCodeLanguageModel(options: {
  readonly modelId: string
  readonly transport: HttpTransport
  readonly readApiKey: (signal: AbortSignal) => Promise<string | null>
}): LanguageModelV3 {
  const provider = parseProviderId("command-code")
  const sdkFetch = createSdkFetch(options.transport)

  async function select(call: LanguageModelV3CallOptions): Promise<LanguageModelV3> {
    const signal = call.abortSignal ?? new AbortController().signal
    if (signal.aborted) throw new OperationCancelledError("command-code-generation")
    const key = await options.readApiKey(signal)
    if (signal.aborted) throw new OperationCancelledError("command-code-generation")
    if (key === null || key.trim().length === 0) {
      throw new AdapterError({
        operation: "command-code-missing-api-key",
        providerId: provider,
        retryable: false,
        cause: null,
      })
    }
    const capabilities = await listCommandCodeCapabilities({
      transport: options.transport,
      apiKey: key,
      signal,
    })
    if (signal.aborted) throw new OperationCancelledError("command-code-generation")
    const selected = capabilities.find((entry) => entry.model.id === options.modelId)
    if (selected === undefined) {
      throw new AdapterError({
        operation: "command-code-model-endpoint-unavailable",
        providerId: provider,
        retryable: false,
        cause: null,
      })
    }
    switch (selected.endpoint) {
      case "chat":
        return createOpenAI({
          name: "command-code",
          baseURL: "https://api.commandcode.ai/provider/v1",
          apiKey: key,
          fetch: sdkFetch,
        }).chat(options.modelId)
      case "responses":
        return createOpenAI({
          name: "command-code",
          baseURL: "https://api.commandcode.ai/provider/v1",
          apiKey: key,
          fetch: sdkFetch,
        }).responses(options.modelId)
      case "messages":
        return createAnthropic({
          name: "command-code",
          baseURL: "https://api.commandcode.ai/provider/v1",
          apiKey: key,
          fetch: sdkFetch,
        }).messages(options.modelId)
      default: {
        const unreachable: never = selected.endpoint
        return unreachable
      }
    }
  }

  return {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async (call) => (await select(call)).doGenerate(call),
    doStream: async (call) => (await select(call)).doStream(call),
  }
}
