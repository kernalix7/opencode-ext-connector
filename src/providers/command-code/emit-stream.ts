// Derived from thaolaptrinh/commandcode-api-proxy@f4b3390e2f18a42bc164a1a94a4d796e20d19700.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

import { createNdjsonStreamParser } from "./ndjson"
import { commandCodeToolParts } from "./tool-stream"

export async function emitCommandCodeChunks(
  chunks: AsyncIterable<Uint8Array>,
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
): Promise<void> {
  const parser = createNdjsonStreamParser()
  controller.enqueue({ type: "stream-start", warnings: [] })
  let textStarted = false
  const emitText = (delta: { readonly id: string; readonly delta: string }): void => {
    if (!textStarted) {
      controller.enqueue({ type: "text-start", id: "text-1" })
      textStarted = true
    }
    controller.enqueue({ type: "text-delta", id: delta.id, delta: delta.delta })
  }
  let buffer = ""
  const consumeLine = (line: string): void => {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed === "[DONE]") {
      return
    }
    const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    if (typeof parsed !== "object" || parsed === null) {
      return
    }
    for (const part of commandCodeToolParts(parsed)) {
      controller.enqueue(part)
    }
    for (const delta of parser.parse(new TextEncoder().encode(`${payload}\n`))) {
      emitText(delta)
    }
  }
  for await (const chunk of chunks) {
    buffer += new TextDecoder().decode(chunk)
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      consumeLine(line)
    }
  }
  if (buffer.length > 0) {
    consumeLine(buffer)
  }
  for (const delta of parser.flush()) {
    emitText(delta)
  }
  if (textStarted) {
    controller.enqueue({ type: "text-end", id: "text-1" })
  }
}
