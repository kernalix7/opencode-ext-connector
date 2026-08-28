import { describe, expect, it } from "bun:test"

import {
  decodeProtobufValue,
  encodeProtobufValue,
} from "../../../../src/providers/cursor/proto-value"
import { decodeFields } from "../../../../src/providers/cursor/proto-wire"

describe("encodeProtobufValue", () => {
  it("encodes an object as struct_value field 5", () => {
    // Given
    const encoded = encodeProtobufValue({ type: "object" })

    // When
    const [field] = decodeFields(encoded)

    // Then
    expect(field?.field).toBe(5)
    expect(field?.wire).toBe(2)
  })

  it("round-trips a command string inside a struct", () => {
    // Given
    const encoded = encodeProtobufValue({ command: "git status --short" })

    // When
    const decoded = decodeProtobufValue(encoded)

    // Then
    expect(decoded).toEqual({ command: "git status --short" })
  })
})
