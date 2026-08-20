import type { LanguageModelV3Usage } from "@ai-sdk/provider"

export function emptyCursorUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  }
}

export function cursorUsage(value: object): LanguageModelV3Usage | null {
  if (!("usage" in value)) {
    return null
  }
  const rawUsage = value.usage
  if (typeof rawUsage !== "object" || rawUsage === null) {
    return null
  }
  const numberField = (key: string): number | undefined => {
    const field = Reflect.get(rawUsage, key)
    return typeof field === "number" ? field : undefined
  }
  const input = numberField("inputTokens")
  const output = numberField("outputTokens")
  return {
    inputTokens: {
      total: input,
      noCache: input,
      cacheRead: numberField("cacheReadTokens"),
      cacheWrite: numberField("cacheWriteTokens"),
    },
    outputTokens: { total: output, text: output, reasoning: undefined },
  }
}
