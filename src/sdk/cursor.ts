import type { LanguageModelV3 } from "@ai-sdk/provider"

import { languageForV1Provider } from "../opencode/v1-language"

export type CursorProvider = {
  readonly languageModel: (modelId: string) => LanguageModelV3
}

export function createCursor(options: Readonly<Record<string, unknown>> = {}): CursorProvider {
  return {
    languageModel: (modelId: string): LanguageModelV3 =>
      languageForV1Provider("cursor", modelId, options),
  }
}
