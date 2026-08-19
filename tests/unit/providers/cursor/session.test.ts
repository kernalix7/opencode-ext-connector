import { describe, expect, it } from "bun:test"

import { extractCursorSessionId } from "../../../../src/providers/cursor/session"

describe("extractCursorSessionId", () => {
  it("reads session_id from a system or result event", () => {
    // Given
    const line = '{"type":"system","session_id":"abc-123"}'
    // When
    const id = extractCursorSessionId(line)
    // Then
    expect(id).toBe("abc-123")
  })

  it("reads chatId when session_id is absent", () => {
    // Given
    const line = '{"type":"result","chatId":"chat-9"}'
    // When
    const id = extractCursorSessionId(line)
    // Then
    expect(id).toBe("chat-9")
  })

  it("returns null for unrelated lines", () => {
    // Given / When / Then
    expect(extractCursorSessionId('{"type":"text","text":"hi"}')).toBeNull()
  })
})
