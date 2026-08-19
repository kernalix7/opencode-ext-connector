import { describe, expect, it } from "bun:test"

import { createSseParseState, parseAnthropicSse } from "../../../../src/providers/claude/sse"

describe("parseAnthropicSse", () => {
  it("keeps event type across chunk boundary until data arrives", () => {
    // Given
    let state = createSseParseState()
    const first = new TextEncoder().encode("event: content_block_delta\n")
    // When
    const mid = parseAnthropicSse(first, state)
    state = mid.state
    const second = new TextEncoder().encode(
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n',
    )
    const done = parseAnthropicSse(second, state)
    // Then
    expect(mid.events).toEqual([])
    expect(
      done.events.some((event) => event.kind === "part" && event.part.type === "text-delta"),
    ).toBe(true)
  })
})
