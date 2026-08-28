import { describe, expect, it } from "bun:test"

import {
  decodeConversationCheckpoint,
  encodeConversationCheckpoint,
} from "../../../../../src/providers/cursor/proto/checkpoint"
import {
  CursorProtocolDriftError,
  CursorProtocolError,
} from "../../../../../src/providers/cursor/proto/errors"

const EMPTY_TOKEN_DETAILS = Uint8Array.from([0x2a, 0x00])
const ONLY_USED_TOKENS = Uint8Array.from([0x2a, 0x02, 0x08, 0x07])
const ONLY_MAX_TOKENS = Uint8Array.from([0x2a, 0x02, 0x10, 0x0b])
const BOTH_NONZERO = Uint8Array.from([0x2a, 0x04, 0x08, 0x07, 0x10, 0x0b])
const DUPLICATE_USED_TOKENS = Uint8Array.from([0x2a, 0x04, 0x08, 0x01, 0x08, 0x02])
const DUPLICATE_MAX_TOKENS = Uint8Array.from([0x2a, 0x04, 0x10, 0x01, 0x10, 0x02])
const USED_TOKENS_WRONG_WIRE = Uint8Array.from([0x2a, 0x03, 0x0a, 0x01, 0x01])
// Installed descriptor: {no:3,name:"breakdown",kind:"message",T:Ys,opt:!0}
const EMPTY_BREAKDOWN = Uint8Array.from([0x2a, 0x02, 0x1a, 0x00])
const NONEMPTY_BREAKDOWN = Uint8Array.from([0x2a, 0x04, 0x1a, 0x02, 0xaa, 0xbb])
const DUPLICATE_BREAKDOWN = Uint8Array.from([0x2a, 0x04, 0x1a, 0x00, 0x1a, 0x00])
const BREAKDOWN_WRONG_WIRE = Uint8Array.from([0x2a, 0x02, 0x18, 0x00])
const UNKNOWN_FIELD_6 = Uint8Array.from([0x2a, 0x02, 0x30, 0x01])

describe("ConversationTokenDetails proto3 scalar defaults", () => {
  for (const [name, fixture, usedTokens, maxTokens] of [
    ["an empty nested message", EMPTY_TOKEN_DETAILS, 0, 0],
    ["only used_tokens", ONLY_USED_TOKENS, 7, 0],
    ["only max_tokens", ONLY_MAX_TOKENS, 0, 11],
    ["both nonzero scalars", BOTH_NONZERO, 7, 11],
  ] as const) {
    it(`round-trips ${name}`, () => {
      // Given
      // When
      const checkpoint = decodeConversationCheckpoint(fixture)

      // Then
      expect(checkpoint.tokenDetails).toEqual({ usedTokens, maxTokens })
      expect(encodeConversationCheckpoint(checkpoint)).toEqual(fixture)
    })
  }

  for (const [field, fixture] of [
    [1, DUPLICATE_USED_TOKENS],
    [2, DUPLICATE_MAX_TOKENS],
  ] as const) {
    it(`rejects duplicate field ${field}`, () => {
      // Given
      // When
      const decode = (): void => {
        decodeConversationCheckpoint(fixture)
      }

      // Then
      expect(decode).toThrow(CursorProtocolError)
      expect(decode).toThrow(
        `ConversationTokenDetails: malformed: field ${field} appears more than once`,
      )
    })
  }

  it("rejects a supported wrong wire", () => {
    // Given
    const fixture = USED_TOKENS_WRONG_WIRE

    // When
    const decode = (): void => {
      decodeConversationCheckpoint(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow(
      "ConversationTokenDetails: wrong-wire: field 1 expected wire 0, received 2",
    )
  })

  for (const [name, fixture, breakdown] of [
    ["an empty breakdown", EMPTY_BREAKDOWN, new Uint8Array()],
    ["a non-empty breakdown", NONEMPTY_BREAKDOWN, Uint8Array.from([0xaa, 0xbb])],
  ] as const) {
    it(`round-trips ${name} as opaque bytes`, () => {
      // Given
      // When
      const checkpoint = decodeConversationCheckpoint(fixture)

      // Then
      expect(checkpoint.tokenDetails).toEqual({ usedTokens: 0, maxTokens: 0, breakdown })
      expect(encodeConversationCheckpoint(checkpoint)).toEqual(fixture)
    })
  }

  it("rejects duplicate breakdown field 3", () => {
    // Given
    const fixture = DUPLICATE_BREAKDOWN

    // When
    const decode = (): void => {
      decodeConversationCheckpoint(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow("ConversationTokenDetails: malformed: field 3 appears more than once")
  })

  it("rejects breakdown field 3 on the wrong wire", () => {
    // Given
    const fixture = BREAKDOWN_WRONG_WIRE

    // When
    const decode = (): void => {
      decodeConversationCheckpoint(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow(
      "ConversationTokenDetails: wrong-wire: field 3 expected wire 2, received 0",
    )
  })

  it("rejects unknown nested field 6 as protocol drift", () => {
    // Given
    const fixture = UNKNOWN_FIELD_6

    // When
    const decode = (): void => {
      decodeConversationCheckpoint(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolDriftError)
    expect(decode).toThrow("ConversationTokenDetails: field 6")
  })
})
