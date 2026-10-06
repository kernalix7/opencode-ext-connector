import type { LanguageModelV3 } from "@ai-sdk/provider"

import { NoSuchModelError } from "@ai-sdk/provider"

export class CursorRetiredError extends NoSuchModelError {
  public override readonly name = "CursorRetiredError"

  public constructor(modelId: string) {
    super({
      modelId,
      modelType: "languageModel",
      message: "Cursor is unsupported; use a supported provider instead.",
    })
  }
}

export type CursorProvider = {
  readonly languageModel: (modelId: string) => LanguageModelV3
}

export function createCursor(_options: Readonly<Record<string, unknown>> = {}): CursorProvider {
  return {
    languageModel: (modelId: string): LanguageModelV3 => {
      throw new CursorRetiredError(modelId)
    },
  }
}
