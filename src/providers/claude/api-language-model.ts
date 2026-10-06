import { createAnthropic } from "@ai-sdk/anthropic"
import type { LanguageModelV3 } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import { parseProviderId } from "../../core/ids.js"
import { createSdkFetch } from "../../http/sdk-fetch.js"

export type ClaudeApiLanguageModelOptions = {
  readonly modelId: string
  readonly transport: HttpTransport
  readonly readApiKey: (signal: AbortSignal) => Promise<string | null>
}

export function createClaudeLanguageModel(options: ClaudeApiLanguageModelOptions): LanguageModelV3 {
  const sdkFetch = createSdkFetch(options.transport)
  const providerId = parseProviderId("claude")
  const createForCall = async (signal: AbortSignal): Promise<LanguageModelV3> => {
    if (signal.aborted) throw new OperationCancelledError("claude-generate")
    const key = await options.readApiKey(signal)
    if (signal.aborted) throw new OperationCancelledError("claude-generate")
    if (!key) {
      throw new AdapterError({
        operation: "claude-api-key",
        providerId,
        retryable: false,
        cause: null,
      })
    }
    return createAnthropic({
      apiKey: key,
      baseURL: "https://api.anthropic.com/v1",
      name: "claude",
      fetch: sdkFetch,
    }).languageModel(options.modelId)
  }
  return {
    specificationVersion: "v3",
    provider: "claude",
    modelId: options.modelId,
    supportedUrls: {
      "image/*": [/^https?:\/\//],
      "application/pdf": [/^https?:\/\//],
    },
    doGenerate: async (call) => {
      const signal = call.abortSignal ?? new AbortController().signal
      const model = await createForCall(signal)
      if (signal.aborted) throw new OperationCancelledError("claude-generate")
      return model.doGenerate({ ...call, abortSignal: signal })
    },
    doStream: async (call) => {
      const signal = call.abortSignal ?? new AbortController().signal
      const model = await createForCall(signal)
      if (signal.aborted) throw new OperationCancelledError("claude-generate")
      return model.doStream({ ...call, abortSignal: signal })
    },
  }
}
