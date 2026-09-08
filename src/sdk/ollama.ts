import type { LanguageModelV3 } from "@ai-sdk/provider"

import { languageForV1Provider } from "../opencode/v1-language.js"

export type OllamaProvider = {
  readonly languageModel: (modelId: string) => LanguageModelV3
}

export type OllamaProviderOptions = {
  readonly ollamaBaseURL?: string
}

export function createOllama(options: OllamaProviderOptions = {}): OllamaProvider {
  return {
    languageModel: (modelId: string): LanguageModelV3 =>
      languageForV1Provider("ollama", modelId, options),
  }
}
