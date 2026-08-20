import type { LanguageModelV3 } from "@ai-sdk/provider"

import { languageForV1Provider } from "../opencode/v1-language"

export type CommandCodeProvider = {
  readonly languageModel: (modelId: string) => LanguageModelV3
}

export function createCommandCode(
  options: Readonly<Record<string, unknown>> = {},
): CommandCodeProvider {
  return {
    languageModel: (modelId: string): LanguageModelV3 =>
      languageForV1Provider("command-code", modelId, options),
  }
}
