import { describe, expect, it } from "bun:test"

import {
  decodeFields,
  decodeUtf8,
  encodeBytesField,
  encodeStringField,
} from "../../../../src/providers/cursor/proto-wire"

describe("cursor proto-wire", () => {
  it("round-trips a string field", () => {
    // Given
    const encoded = encodeStringField(1, "gpt-5.2")

    // When
    const [field] = decodeFields(encoded)

    // Then
    expect(field?.field).toBe(1)
    expect(decodeUtf8(field?.bytes ?? new Uint8Array())).toBe("gpt-5.2")
  })

  it("reads nested model_id strings from a GetUsableModels-shaped payload", () => {
    // Given
    const model = encodeStringField(1, "composer-2")
    const payload = encodeBytesField(1, model)

    // When
    const ids: string[] = []
    for (const entry of decodeFields(payload)) {
      if (entry.field !== 1) {
        continue
      }
      for (const inner of decodeFields(entry.bytes)) {
        if (inner.field === 1) {
          ids.push(decodeUtf8(inner.bytes))
        }
      }
    }

    // Then
    expect(ids).toEqual(["composer-2"])
  })
})
