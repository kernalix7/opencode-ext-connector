import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { HttpTransport } from "../core/http.js"
import { createClaudeVersionResolver } from "../providers/claude/cli-version.js"
import { createClaudeSubscriptionLanguageModel } from "../providers/claude/subscription-language-model.js"
import { createCommandCodeLanguageModel } from "../providers/command-code/subscription-language-model.js"
import { createOllamaLanguageModel } from "../providers/ollama/language-model.js"
import type { OllamaRuntime } from "../providers/ollama/runtime.js"

export type ConnectorLanguageDeps = {
  readonly transport: HttpTransport
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly ollamaRuntime?: OllamaRuntime
}

export function createConnectorLanguage(
  deps: ConnectorLanguageDeps,
): (providerID: string, modelId: string) => LanguageModelV3 | null {
  return (providerID, modelId) => {
    switch (providerID) {
      case "claude":
        return createClaudeSubscriptionLanguageModel({
          modelId,
          transport: deps.transport,
          readAccessToken: deps.readAccessToken,
          forceRefreshAccessToken: deps.forceRefreshAccessToken,
          readVersion: createClaudeVersionResolver({ env: deps.env, transport: deps.transport }),
        })
      case "command-code":
        return createCommandCodeLanguageModel({
          modelId,
          transport: deps.transport,
          readAccessToken: deps.readAccessToken,
          env: deps.env,
        })
      case "ollama":
        return deps.ollamaRuntime === undefined
          ? null
          : createOllamaLanguageModel({ modelId, runtime: deps.ollamaRuntime })
      default:
        return null
    }
  }
}
