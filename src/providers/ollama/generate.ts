import type {
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  SharedV3Warning,
} from "@ai-sdk/provider"

export async function generateFromOllamaStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): Promise<LanguageModelV3GenerateResult> {
  const content: LanguageModelV3Content[] = []
  const text: string[] = []
  const reasoning: string[] = []
  let warnings: SharedV3Warning[] = []
  let finish: Extract<LanguageModelV3StreamPart, { readonly type: "finish" }> | null = null
  const reader = stream.getReader()
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      switch (next.value.type) {
        case "text-delta":
          text.push(next.value.delta)
          break
        case "reasoning-delta":
          reasoning.push(next.value.delta)
          break
        case "tool-call":
          content.push(next.value)
          break
        case "finish":
          finish = next.value
          break
        case "stream-start":
          warnings = next.value.warnings
          break
        case "error":
          throw next.value.error
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (finish === null) throw new TypeError("Ollama stream ended without a finish part")
  if (text.length > 0) content.unshift({ type: "text", text: text.join("") })
  if (reasoning.length > 0) content.unshift({ type: "reasoning", text: reasoning.join("") })
  return {
    content,
    finishReason: finish.finishReason,
    usage: finish.usage,
    warnings,
  }
}
