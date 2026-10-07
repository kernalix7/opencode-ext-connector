import { createAnthropic } from "@ai-sdk/anthropic"
import type { LanguageModelV3 } from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import { parseProviderId } from "../../core/ids.js"
import { createSdkFetch } from "../../http/sdk-fetch.js"
import { createClaudeCompatibilityFetch } from "./compat-request.js"

export type ClaudeSubscriptionLanguageModelOptions = {
  readonly modelId: string
  readonly transport: HttpTransport
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly readVersion: (signal: AbortSignal) => Promise<string | null>
}

export function createClaudeSubscriptionLanguageModel(
  options: ClaudeSubscriptionLanguageModelOptions,
): LanguageModelV3 {
  const compatFetch = createClaudeCompatibilityFetch({
    fetch: createSdkFetch(options.transport),
    readAccessToken: options.readAccessToken,
    forceRefreshAccessToken: options.forceRefreshAccessToken,
    readVersion: options.readVersion,
  })
  const createForCall = async (signal: AbortSignal): Promise<LanguageModelV3> => {
    if (signal.aborted) throw new OperationCancelledError("claude-generate")
    const token = await options.readAccessToken(signal)
    if (signal.aborted) throw new OperationCancelledError("claude-generate")
    if (!token)
      throw new AdapterError({
        operation: "claude-credentials",
        providerId: parseProviderId("claude"),
        retryable: false,
        cause: null,
      })
    return createAnthropic({
      authToken: token,
      baseURL: "https://api.anthropic.com/v1",
      name: "claude",
      fetch: compatFetch,
    }).languageModel(options.modelId)
  }
  return {
    specificationVersion: "v3",
    provider: "claude",
    modelId: options.modelId,
    supportedUrls: { "image/*": [/^https?:\/\//], "application/pdf": [/^https?:\/\//] },
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
