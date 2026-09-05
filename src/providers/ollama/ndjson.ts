import type { z } from "zod"

import { OllamaGenerationError, type OllamaGenerationOperation } from "./errors.js"

const MAX_LINE_BYTES = 1024 * 1024

function appendLine(
  buffered: Uint8Array,
  chunk: Uint8Array,
  operation: OllamaGenerationOperation,
): Uint8Array {
  if (buffered.byteLength + chunk.byteLength > MAX_LINE_BYTES) {
    throw new OllamaGenerationError(operation)
  }
  const joined = new Uint8Array(buffered.byteLength + chunk.byteLength)
  joined.set(buffered)
  joined.set(chunk, buffered.byteLength)
  return joined
}

export async function* parseOllamaNdjson<T>(
  response: Response,
  schema: z.ZodType<T>,
  operation: OllamaGenerationOperation,
): AsyncGenerator<T> {
  if (response.body === null) throw new OllamaGenerationError(operation)
  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffered: Uint8Array = new Uint8Array()
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      let start = 0
      for (let index = 0; index < result.value.byteLength; index += 1) {
        if (result.value[index] !== 0x0a) continue
        const lineBytes = appendLine(buffered, result.value.subarray(start, index), operation)
        buffered = new Uint8Array()
        start = index + 1
        const line = decoder.decode(lineBytes)
        if (line.trim().length === 0) continue
        yield schema.parse(JSON.parse(line))
      }
      buffered = appendLine(buffered, result.value.subarray(start), operation)
    }
    if (buffered.byteLength > 0) {
      const line = decoder.decode(buffered)
      if (line.trim().length > 0) yield schema.parse(JSON.parse(line))
    }
  } catch (error) {
    if (error instanceof OllamaGenerationError) throw error
    throw new OllamaGenerationError(operation)
  } finally {
    reader.releaseLock()
  }
}
