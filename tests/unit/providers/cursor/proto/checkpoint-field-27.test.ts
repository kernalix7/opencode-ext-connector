import { describe, expect, it } from "bun:test"

import {
  decodeConversationCheckpoint,
  encodeConversationCheckpoint,
} from "../../../../../src/providers/cursor/proto/checkpoint"
import { CursorProtocolError } from "../../../../../src/providers/cursor/proto/errors"

const FIELD_27_TAG = [0xda, 0x01]
const EMPTY_CHECKPOINT = new Uint8Array()
const ASIA_SEOUL = Uint8Array.from([
  ...FIELD_27_TAG,
  0x0a,
  0x41,
  0x73,
  0x69,
  0x61,
  0x2f,
  0x53,
  0x65,
  0x6f,
  0x75,
  0x6c,
])
const EXPLICIT_EMPTY = Uint8Array.from([...FIELD_27_TAG, 0x00])
const DUPLICATE_FIELD_27 = Uint8Array.from([...ASIA_SEOUL, ...EXPLICIT_EMPTY])
const WIRE_0 = Uint8Array.from([0xd8, 0x01, 0x00])
const WIRE_1 = Uint8Array.from([0xd9, 0x01, 0, 0, 0, 0, 0, 0, 0, 0])
const WIRE_5 = Uint8Array.from([0xdd, 0x01, 0, 0, 0, 0])
const WIRE_3 = Uint8Array.from([0xdb, 0x01])
const WIRE_4 = Uint8Array.from([0xdc, 0x01])
const WIRE_6 = Uint8Array.from([0xde, 0x01])
const WIRE_7 = Uint8Array.from([0xdf, 0x01])
const INVALID_UTF_8 = Uint8Array.from([...FIELD_27_TAG, 0x01, 0xff])

describe("ConversationStateStructure field 27 optional string", () => {
  it("preserves an absent field", () => {
    // Given
    const fixture = EMPTY_CHECKPOINT

    // When
    const checkpoint = decodeConversationCheckpoint(fixture)

    // Then
    expect(checkpoint.conversationStartedTimeZone).toBeUndefined()
    expect(encodeConversationCheckpoint(checkpoint)).toEqual(fixture)
  })

  for (const [name, fixture, value] of [
    ["Asia/Seoul", ASIA_SEOUL, "Asia/Seoul"],
    ["an explicit empty string", EXPLICIT_EMPTY, ""],
  ] as const) {
    it(`round-trips ${name}`, () => {
      // Given
      // When
      const checkpoint = decodeConversationCheckpoint(fixture)

      // Then
      expect(checkpoint.conversationStartedTimeZone).toBe(value)
      expect(encodeConversationCheckpoint(checkpoint)).toEqual(fixture)
    })
  }

  it("rejects duplicate field 27", () => {
    // Given
    const fixture = DUPLICATE_FIELD_27

    // When
    const decode = (): void => {
      decodeConversationCheckpoint(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow("ConversationStateStructure: malformed: field 27 appears more than once")
  })

  for (const [wire, fixture] of [
    [0, WIRE_0],
    [1, WIRE_1],
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
        `ConversationStateStructure: wrong-wire: field 27 expected wire 2, received ${wire}`,
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

  it("rejects invalid UTF-8", () => {
    // Given
    const fixture = INVALID_UTF_8

    // When
    const decode = (): void => {
      decodeConversationCheckpoint(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow("ConversationStateStructure field 27: malformed: invalid UTF-8")
  })
})
