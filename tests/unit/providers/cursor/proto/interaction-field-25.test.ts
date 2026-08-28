import { describe, expect, it } from "bun:test"

import { CursorProtocolError } from "../../../../../src/providers/cursor/proto/errors"
import {
  decodeInteractionUpdate,
  encodeInteractionUpdate,
} from "../../../../../src/providers/cursor/proto/interaction"

const FIELD_25_TAG = [0xc8, 0x01]
const OVERLONG_ONE = [0x81, 0x00]
const FIELD_25_ONLY = Uint8Array.from([...FIELD_25_TAG, ...OVERLONG_ONE])
const TEXT_UPDATE = [0x0a, 0x06, 0x0a, 0x04, 0x74, 0x65, 0x78, 0x74]
const FIELD_25_BEFORE_TEXT = Uint8Array.from([...FIELD_25_TAG, ...OVERLONG_ONE, ...TEXT_UPDATE])
const FIELD_25_AFTER_TEXT = Uint8Array.from([...TEXT_UPDATE, ...FIELD_25_TAG, ...OVERLONG_ONE])
const DUPLICATE_FIELD_25 = Uint8Array.from([...FIELD_25_ONLY, ...FIELD_25_ONLY])
const LEGACY_WIRE_2 = Uint8Array.from([0xca, 0x01, 0x01, 0x01])
const WIRE_1 = Uint8Array.from([0xc9, 0x01, 0, 0, 0, 0, 0, 0, 0, 0])
const WIRE_5 = Uint8Array.from([0xcd, 0x01, 0, 0, 0, 0])
const WIRE_3 = Uint8Array.from([0xcb, 0x01])
const WIRE_4 = Uint8Array.from([0xcc, 0x01])
const WIRE_6 = Uint8Array.from([0xce, 0x01])
const WIRE_7 = Uint8Array.from([0xcf, 0x01])

describe("InteractionUpdate field 25 wire 0", () => {
  it("round-trips a field25-only raw overlong varint exactly", () => {
    // Given
    const fixture = FIELD_25_ONLY

    // When
    const update = decodeInteractionUpdate(fixture)

    // Then
    expect(update).toEqual({ kind: "field-25", payload: new Uint8Array(OVERLONG_ONE) })
    expect(encodeInteractionUpdate(update)).toEqual(fixture)
  })

  it("preserves field25 before text", () => {
    // Given
    const fixture = FIELD_25_BEFORE_TEXT

    // When
    const update = decodeInteractionUpdate(fixture)

    // Then
    expect(update).toEqual({
      kind: "text-delta",
      text: "text",
      field25Telemetry: { placement: "before-semantic", payload: new Uint8Array(OVERLONG_ONE) },
    })
    expect(encodeInteractionUpdate(update)).toEqual(fixture)
  })

  it("preserves field25 after text", () => {
    // Given
    const fixture = FIELD_25_AFTER_TEXT

    // When
    const update = decodeInteractionUpdate(fixture)

    // Then
    expect(update).toEqual({
      kind: "text-delta",
      text: "text",
      field25Telemetry: { placement: "after-semantic", payload: new Uint8Array(OVERLONG_ONE) },
    })
    expect(encodeInteractionUpdate(update)).toEqual(fixture)
  })

  it("rejects duplicate field25 wire 0", () => {
    // Given
    const fixture = DUPLICATE_FIELD_25

    // When
    const decode = (): void => {
      decodeInteractionUpdate(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow("InteractionUpdate: malformed: field 25 appears more than once")
  })

  for (const [name, fixture, wire] of [
    ["legacy wire 2", LEGACY_WIRE_2, 2],
    ["wire 1", WIRE_1, 1],
    ["wire 5", WIRE_5, 5],
  ] as const) {
    it(`rejects ${name}`, () => {
      // Given
      // When
      const decode = (): void => {
        decodeInteractionUpdate(fixture)
      }

      // Then
      expect(decode).toThrow(CursorProtocolError)
      expect(decode).toThrow(
        `InteractionUpdate: wrong-wire: field 25 expected wire 0, received ${wire}`,
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
        decodeInteractionUpdate(fixture)
      }

      // Then
      expect(decode).toThrow(CursorProtocolError)
      expect(decode).toThrow(`InteractionUpdate: wrong-wire: unsupported wire type ${wire}`)
    })
  }
})
