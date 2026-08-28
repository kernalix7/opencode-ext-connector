import { describe, expect, it } from "bun:test"

import {
  decodeConversationCheckpoint,
  encodeConversationCheckpoint,
} from "../../../../../src/providers/cursor/proto/checkpoint"
import {
  CursorProtocolDriftError,
  CursorProtocolError,
} from "../../../../../src/providers/cursor/proto/errors"

const FIELD_26_TAG = [0xd0, 0x01]
const EMPTY_CHECKPOINT = new Uint8Array()
const EXPLICIT_ZERO = Uint8Array.from([...FIELD_26_TAG, 0x00])
const OVERLONG_ONE = Uint8Array.from([...FIELD_26_TAG, 0x81, 0x00])
const MAX_UINT64 = Uint8Array.from([
  ...FIELD_26_TAG,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0x01,
])
const DUPLICATE_FIELD_26 = Uint8Array.from([...EXPLICIT_ZERO, ...EXPLICIT_ZERO])
const WIRE_1 = Uint8Array.from([0xd1, 0x01, 0, 0, 0, 0, 0, 0, 0, 0])
const WIRE_2 = Uint8Array.from([0xd2, 0x01, 0x01, 0x01])
const WIRE_5 = Uint8Array.from([0xd5, 0x01, 0, 0, 0, 0])
const WIRE_3 = Uint8Array.from([0xd3, 0x01])
const WIRE_4 = Uint8Array.from([0xd4, 0x01])
const WIRE_6 = Uint8Array.from([0xd6, 0x01])
const WIRE_7 = Uint8Array.from([0xd7, 0x01])
const UNKNOWN_FIELD_35 = Uint8Array.from([0x98, 0x02, 0x01])

describe("ConversationStateStructure field 26 wire 0", () => {
  it("preserves an absent field", () => {
    // Given
    const fixture = EMPTY_CHECKPOINT

    // When
    const checkpoint = decodeConversationCheckpoint(fixture)

    // Then
    expect(checkpoint.conversationStartedTimestampMs).toBeUndefined()
    expect(encodeConversationCheckpoint(checkpoint)).toEqual(fixture)
  })

  for (const [name, fixture, value] of [
    ["explicit zero", EXPLICIT_ZERO, [0x00]],
    ["overlong one", OVERLONG_ONE, [0x81, 0x00]],
    ["maximum uint64", MAX_UINT64, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]],
  ] as const) {
    it(`round-trips ${name} raw bytes`, () => {
      // Given
      // When
      const checkpoint = decodeConversationCheckpoint(fixture)

      // Then
      expect(checkpoint.conversationStartedTimestampMs).toEqual(Uint8Array.from(value))
      expect(encodeConversationCheckpoint(checkpoint)).toEqual(fixture)
    })
  }

  it("rejects duplicate field 26", () => {
    // Given
    const fixture = DUPLICATE_FIELD_26

    // When
    const decode = (): void => {
      decodeConversationCheckpoint(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow("ConversationStateStructure: malformed: field 26 appears more than once")
  })

  for (const [wire, fixture] of [
    [1, WIRE_1],
    [2, WIRE_2],
    [5, WIRE_5],
  ] as const) {
    it(`rejects supported wrong wire ${wire}`, () => {
      // Given
      // When
      const decode = (): void => {
        decodeConversationCheckpoint(fixture)
      }

      // Then
      expect(decode).toThrow(CursorProtocolError)
      expect(decode).toThrow(
        `ConversationStateStructure: wrong-wire: field 26 expected wire 0, received ${wire}`,
      )
    })
  }

  for (const [wire, fixture] of [
    [3, WIRE_3],
    [4, WIRE_4],
    [6, WIRE_6],
    [7, WIRE_7],
  ] as const) {
    it(`rejects unsupported wire ${wire}`, () => {
      // Given
      // When
      const decode = (): void => {
        decodeConversationCheckpoint(fixture)
      }

      // Then
      expect(decode).toThrow(CursorProtocolError)
      expect(decode).toThrow(
        `ConversationStateStructure: wrong-wire: unsupported wire type ${wire}`,
      )
    })
  }

  it("rejects unknown field 35 as protocol drift", () => {
    // Given
    const fixture = UNKNOWN_FIELD_35

    // When
    const decode = (): void => {
      decodeConversationCheckpoint(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolDriftError)
    expect(decode).toThrow("ConversationStateStructure: field 35")
  })
})
