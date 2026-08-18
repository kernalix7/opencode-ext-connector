import { describe, expect, it } from "bun:test"

import { extractCursorNdjsonText } from "../../../../src/providers/cursor/ndjson"

describe("extractCursorNdjsonText", () => {
  it("joins text and result events", () => {
    // Given
    const stream = [
      '{"type":"text","text":"hello"}',
      '{"type":"thinking","text":"ignore"}',
      '{"type":"result","result":" world"}',
    ].join("\n")
    // When
    const text = extractCursorNdjsonText(stream)
    // Then
    expect(text).toBe("hello world")
  })

  it("reads assistant message text and text-delta", () => {
    // Given
    const stream = [
      '{"type":"assistant","message":{"content":"ab"}}',
      '{"type":"text-delta","delta":"c"}',
    ].join("\n")
    // When
    const text = extractCursorNdjsonText(stream)
    // Then
    expect(text).toBe("abc")
  })
})
