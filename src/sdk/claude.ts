import type { LanguageModelV3 } from "@ai-sdk/provider"

import { languageForV1Provider } from "../opencode/v1-language.js"

export type ClaudeProvider = {
  readonly languageModel: (modelId: string) => LanguageModelV3
}

export function createClaude(options: Readonly<Record<string, unknown>> = {}): ClaudeProvider {
  return {
    languageModel: (modelId: string): LanguageModelV3 =>
      languageForV1Provider("claude", modelId, options),
  }
}
