import { describe, expect, it } from "bun:test"

import {
  CursorProtocolDriftError,
  CursorProtocolError,
} from "../../../../../src/providers/cursor/proto/errors"
import {
  decodeInteractionUpdate,
  encodeInteractionUpdate,
} from "../../../../../src/providers/cursor/proto/interaction"

const EMPTY_TURN_ENDED = Uint8Array.from([0x72, 0x00])
const NEGATIVE_ONE = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]
const FIELD_VALUES = [
  [1, [0x08, 0x01]],
  [2, [0x10, 0x02]],
  [3, [0x18, 0x03]],
  [4, [0x20, 0x04]],
  [5, [0x28, ...NEGATIVE_ONE]],
] as const

function turnEnded(payload: readonly number[]): Uint8Array {
  return Uint8Array.from([0x72, payload.length, ...payload])
}

describe("InteractionUpdate TurnEndedUpdate", () => {
  it("preserves an empty TurnEndedUpdate payload and its empty encode contract", () => {
    // Given
    const fixture = EMPTY_TURN_ENDED

    // When
    const update = decodeInteractionUpdate(fixture)

    // Then
    expect(update).toEqual({ kind: "turn-ended", payload: new Uint8Array() })
    expect(encodeInteractionUpdate({ kind: "turn-ended" })).toEqual(fixture)
    expect(encodeInteractionUpdate(update)).toEqual(fixture)
  })

  for (const [field, payload] of FIELD_VALUES) {
    it(`preserves TurnEndedUpdate descriptor field ${field} byte-exactly`, () => {
      // Given
      const fixture = turnEnded(payload)

      // When
      const update = decodeInteractionUpdate(fixture)

      // Then
      expect(update).toEqual({ kind: "turn-ended", payload: Uint8Array.from(payload) })
      expect(encodeInteractionUpdate(update)).toEqual(fixture)
    })
  }

  it("rejects duplicate known TurnEndedUpdate fields", () => {
    // Given
    const fixture = turnEnded([0x08, 0x01, 0x08, 0x02])

    // When
    const decode = (): void => {
      decodeInteractionUpdate(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow("TurnEndedUpdate: malformed: field 1 appears more than once")
  })

  it("rejects a wrong wire for a known TurnEndedUpdate field", () => {
    // Given
    const fixture = turnEnded([0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

    // When
    const decode = (): void => {
      decodeInteractionUpdate(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow("TurnEndedUpdate: wrong-wire: field 1 expected wire 0, received 1")
  })

  it("rejects unknown TurnEndedUpdate field 6 as protocol drift", () => {
    // Given
    const fixture = turnEnded([0x30, 0x01])

    // When
    const decode = (): void => {
      decodeInteractionUpdate(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolDriftError)
    expect(decode).toThrow("TurnEndedUpdate: field 6: unsupported protobuf field or variant")
  })
})
