import { describe, expect, it } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

import { emitCommandCodeChunks } from "../../../../src/providers/command-code/emit-stream"
import { CommandCodeProviderError } from "../../../../src/providers/command-code/errors"

async function emit(lines: string, splitAt: number): Promise<readonly LanguageModelV3StreamPart[]> {
  const bytes = new TextEncoder().encode(lines)
  const chunks = (async function* (): AsyncIterable<Uint8Array> {
    yield bytes.slice(0, splitAt)
    yield bytes.slice(splitAt)
  })()
  const output: LanguageModelV3StreamPart[] = []
  const stream = new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller): Promise<void> {
      await emitCommandCodeChunks(chunks, controller)
      controller.close()
    },
  })
  for await (const part of stream) {
    output.push(part)
  }
  return output
}

async function emitChunks(
  chunks: AsyncIterable<Uint8Array>,
): Promise<readonly LanguageModelV3StreamPart[]> {
  const ready = Promise.withResolvers<ReadableStreamDefaultController<LanguageModelV3StreamPart>>()
  const stream = new ReadableStream<LanguageModelV3StreamPart>({
    start: ready.resolve,
  })
  const controller = await ready.promise
  await emitCommandCodeChunks(chunks, controller)
  controller.close()
  const output: LanguageModelV3StreamPart[] = []
  for await (const part of stream) output.push(part)
  return output
}

describe("emitCommandCodeChunks", () => {
  it("waits for one terminal finish after an intermediate finish-step", async () => {
    // Given
    const ndjson = [
      '{"type":"finish-step","finishReason":"tool-calls","usage":{"inputTokens":2}}',
      '{"type":"finish","finishReason":"stop","rawFinishReason":"end_turn","totalUsage":{"inputTokens":13,"outputTokens":8,"inputTokenDetails":{"noCacheTokens":8,"cacheReadTokens":3,"cacheWriteTokens":2},"outputTokenDetails":{"textTokens":5,"reasoningTokens":3}}}',
    ].join("\n")

    // When
    const parts = await emit(ndjson, 17)

    // Then
    expect(parts).toEqual([
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: { total: 13, noCache: 8, cacheRead: 3, cacheWrite: 2 },
          outputTokens: { total: 8, text: 5, reasoning: 3 },
        },
      },
    ])
  })

  it("preserves safe metadata without provider prose from fragmented NDJSON", async () => {
    // Given
    const ndjson =
      '{"type":"error","error":{"message":"model unavailable","code":"MODEL_NOT_AVAILABLE","statusCode":400,"isRetryable":false}}\n'

    // When
    const parts = await emit(ndjson, 61)

    // Then
    const errorPart = parts.at(0)
    expect(errorPart?.type).toBe("error")
    if (errorPart?.type !== "error" || !(errorPart.error instanceof CommandCodeProviderError)) {
      throw new TypeError("expected a typed Command Code provider error")
    }
    const providerError = errorPart.error
    expect(providerError).toMatchObject({
      name: "CommandCodeProviderError",
      message: "Command Code provider request failed",
      code: "COMMAND_CODE_PROVIDER_ERROR",
      stage: "ndjson-stream",
      statusCode: 400,
      providerCode: "MODEL_NOT_AVAILABLE",
      retryable: false,
    })
    expect(
      Reflect.ownKeys(providerError).map((key) => Reflect.get(providerError, key)),
    ).not.toContain("model unavailable")
  })

  it("accepts exact 1 MiB content when CR and LF framing are split", async () => {
    // Given
    const boundaryRecord = new Uint8Array(1024 * 1024).fill(120)
    const finish = new TextEncoder().encode('data: {"type":"finish","finishReason":"stop"}\r\n')
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      yield boundaryRecord
      yield new Uint8Array([13])
      yield new Uint8Array([10])
      yield finish
    })()

    // When
    const parts = await emitChunks(chunks)

    // Then
    expect(parts.at(0)?.type).toBe("finish")
  })

  it("rejects one content byte over 1 MiB before CRLF framing", async () => {
    // Given
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      yield new Uint8Array(1024 * 1024 + 1)
      yield new Uint8Array([13])
      yield new Uint8Array([10])
    })()

    // When
    const emission = emitChunks(chunks)

    // Then
    await expect(emission).rejects.toMatchObject({ reason: "stream-record-too-large" })
  })

  it("counts a standalone CR as record content", async () => {
    // Given
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      yield new Uint8Array(1024 * 1024)
      yield new Uint8Array([13])
      yield new Uint8Array([120, 10])
    })()

    // When
    const emission = emitChunks(chunks)

    // Then
    await expect(emission).rejects.toMatchObject({ reason: "stream-record-too-large" })
  })

  it("rejects a record one byte over 1 MiB when UTF-8 is fragmented", async () => {
    // Given
    const bytes = new TextEncoder().encode(`${"é".repeat(512 * 1024)}x`)
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      yield bytes.slice(0, 1)
      yield bytes.slice(1)
    })()

    // When
    const emission = emitChunks(chunks)

    // Then
    await expect(emission).rejects.toMatchObject({
      name: "CommandCodeProviderError",
      reason: "stream-record-too-large",
    })
  })

  it("returns the upstream iterator when a record exceeds 1 MiB", async () => {
    // Given
    let returned = false
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      try {
        yield new Uint8Array(1024 * 1024 + 1)
        yield new Uint8Array([10])
      } finally {
        returned = true
      }
    })()

    // When
    const emission = emitChunks(chunks)

    // Then
    await expect(emission).rejects.toMatchObject({ reason: "stream-record-too-large" })
    expect(returned).toBe(true)
  })
})
