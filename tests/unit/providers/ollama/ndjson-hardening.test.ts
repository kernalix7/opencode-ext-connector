import { describe, expect, it } from "bun:test"
import { z } from "zod"

import { OllamaGenerationError } from "../../../../src/providers/ollama"
import { parseOllamaNdjson } from "../../../../src/providers/ollama/ndjson"

const ValueSchema = z.object({ value: z.string() })

async function consume(response: Response): Promise<readonly unknown[]> {
  return Array.fromAsync(parseOllamaNdjson(response, ValueSchema, "chat-response"))
}

describe("Ollama NDJSON boundaries", () => {
  it("rejects an unfinished line larger than one MiB with a sanitized typed error", async () => {
    // Given
    const response = new Response(`{"value":"${"x".repeat(1024 * 1024)}"}`)
    // When
    const result = consume(response)
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    await expect(result).rejects.toMatchObject({ message: "Ollama generation failed" })
  })

  it("sanitizes malformed UTF-8 without exposing provider bytes", async () => {
    // Given
    const response = new Response(Uint8Array.of(0xff, 0xfe, 0x0a))
    // When
    const result = consume(response)
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    await expect(result).rejects.not.toThrow("255")
  })

  it("sanitizes malformed JSON without exposing provider text", async () => {
    // Given
    const response = new Response('{"private":"do-not-leak"\n')
    // When
    const result = consume(response)
    // Then
    await expect(result).rejects.toBeInstanceOf(OllamaGenerationError)
    await expect(result).rejects.not.toThrow("do-not-leak")
  })
})
