// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

import { createSseParseState, mapStopReason, parseAnthropicSse } from "./sse.js"

type FinishReason = ReturnType<typeof mapStopReason>

export async function emitClaudeSseChunks(
  chunks: AsyncIterable<Uint8Array>,
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
): Promise<void> {
  controller.enqueue({ type: "stream-start", warnings: [] })
  let finishReason: FinishReason = { unified: "stop", raw: "end_turn" }
  let textBlockIndex = 0
  let toolBlockIndex = 0
  let state = createSseParseState()
  const emit = (chunk: Uint8Array): void => {
    const parsed = parseAnthropicSse(chunk, state)
    state = parsed.state
    for (const event of parsed.events) {
      if (event.kind === "part") {
        const part = event.part
        if (part.type === "text-start") {
          textBlockIndex += 1
          controller.enqueue({ ...part, id: `text-${textBlockIndex}` })
        } else if (part.type === "text-delta" || part.type === "text-end") {
          controller.enqueue({ ...part, id: `text-${textBlockIndex}` })
        } else if (part.type === "tool-input-start") {
          toolBlockIndex += 1
          controller.enqueue({ ...part, id: part.id })
        } else if (part.type === "tool-input-delta" || part.type === "tool-input-end") {
          controller.enqueue({ ...part, id: `tool-${toolBlockIndex}` })
        } else {
          controller.enqueue(part)
        }
      } else if (event.kind === "finish") {
        finishReason = mapStopReason(event.stopReason)
      } else if (event.kind === "error") {
        controller.error(event.error)
        return
      }
    }
  }
  for await (const chunk of chunks) {
    emit(chunk)
  }
  if (state.buffer.length > 0 || state.event !== null) {
    emit(new TextEncoder().encode("\n"))
  }
  controller.enqueue({
    type: "finish",
    finishReason,
    usage: {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    },
  })
}
