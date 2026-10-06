import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { HttpTransport } from "../core/http.js"
import { createClaudeLanguageModel } from "../providers/claude/api-language-model.js"
import { createCommandCodeLanguageModel } from "../providers/command-code/api-language-model.js"
import { createOllamaLanguageModel } from "../providers/ollama/language-model.js"
import type { OllamaRuntime } from "../providers/ollama/runtime.js"

export type ConnectorLanguageDeps = {
  readonly transport: HttpTransport
  readonly readClaudeApiKey: (signal: AbortSignal) => Promise<string | null>
  readonly readCommandCodeApiKey: (signal: AbortSignal) => Promise<string | null>
  readonly ollamaRuntime?: OllamaRuntime
}

export function createConnectorLanguage(
  deps: ConnectorLanguageDeps,
): (providerID: string, modelId: string) => LanguageModelV3 | null {
  return (providerID, modelId) => {
    switch (providerID) {
      case "claude":
        return createClaudeLanguageModel({
          modelId,
          transport: deps.transport,
          readApiKey: deps.readClaudeApiKey,
        })
      case "command-code":
        return createCommandCodeLanguageModel({
          modelId,
          transport: deps.transport,
          readApiKey: deps.readCommandCodeApiKey,
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
