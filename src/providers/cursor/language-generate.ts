import type {
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"

import { emptyCursorUsage } from "./usage"

export async function generateFromCursorStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): Promise<LanguageModelV3GenerateResult> {
  const content: LanguageModelV3Content[] = []
  const text: string[] = []
  const reasoning: string[] = []
  let finishReason: LanguageModelV3FinishReason = { unified: "stop", raw: "stop" }
  let usage: LanguageModelV3Usage = emptyCursorUsage()
  for await (const part of stream) {
    if (part.type === "text-delta") text.push(part.delta)
    else if (part.type === "reasoning-delta") reasoning.push(part.delta)
    else if (part.type === "tool-call") {
      content.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      })
    } else if (part.type === "finish") {
      finishReason = part.finishReason
      usage = part.usage
    } else if (part.type === "error") throw part.error
  }
  const joinedText = text.join("")
  if (joinedText.length > 0) content.unshift({ type: "text", text: joinedText })
  const joinedReasoning = reasoning.join("")
  if (joinedReasoning.length > 0) content.unshift({ type: "reasoning", text: joinedReasoning })
  return { content, finishReason, usage, warnings: [] }
}
