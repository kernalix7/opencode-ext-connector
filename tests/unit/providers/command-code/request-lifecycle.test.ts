import { describe, expect, it } from "bun:test"

import { CommandCodeProviderError } from "../../../../src/providers/command-code/errors"
import { readCommandCodeErrorBody } from "../../../../src/providers/command-code/request-lifecycle"

describe("readCommandCodeErrorBody", () => {
  it("accepts an error body at the exact 64 KiB boundary", async () => {
    // Given
    const bytes = new TextEncoder().encode("é".repeat(32 * 1024))
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      yield bytes.slice(0, 1)
      yield bytes.slice(1)
    })()

    // When
    const body = await readCommandCodeErrorBody(chunks)

    // Then
    expect(body).toBe("é".repeat(32 * 1024))
  })

  it("rejects an error body one byte over 64 KiB", async () => {
    // Given
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      yield new Uint8Array(64 * 1024)
      yield new Uint8Array(1)
    })()

    // When
    const reading = readCommandCodeErrorBody(chunks)

    // Then
    await expect(reading).rejects.toBeInstanceOf(CommandCodeProviderError)
    await expect(reading).rejects.toMatchObject({ reason: "response-body-too-large" })
  })

  it("returns the upstream iterator when an error body exceeds 64 KiB", async () => {
    // Given
    let returned = false
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      try {
        yield new Uint8Array(64 * 1024 + 1)
        yield new Uint8Array([1])
      } finally {
        returned = true
      }
    })()

    // When
    const reading = readCommandCodeErrorBody(chunks)

    // Then
    await expect(reading).rejects.toMatchObject({ reason: "response-body-too-large" })
    expect(returned).toBe(true)
  })
})
