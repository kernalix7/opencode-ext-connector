import { describe, expect, it } from "bun:test"

import { encodeBytesField, encodeStringField } from "../../../../src/providers/cursor/proto-wire"
import { extractCursorTextDeltas } from "../../../../src/providers/cursor/run"

describe("extractCursorTextDeltas", () => {
  it("reads interaction_update text_delta strings", () => {
    // Given
    const textDelta = encodeBytesField(1, encodeStringField(1, "pong"))
    const interaction = encodeBytesField(1, textDelta)

    // When
    const deltas = extractCursorTextDeltas(interaction)

    // Then
    expect(deltas).toEqual(["pong"])
  })
})
