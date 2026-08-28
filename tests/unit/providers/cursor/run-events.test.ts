import { describe, expect, it } from "bun:test"

import {
  concatBytes,
  encodeBytesField,
  encodeStringField,
} from "../../../../src/providers/cursor/proto-wire"
import { extractCursorRunEvents } from "../../../../src/providers/cursor/run-events"

function field25Wire0(rawVarintBytes: readonly number[]): Uint8Array {
  return Uint8Array.from([0xc8, 0x01, ...rawVarintBytes])
}

describe("extractCursorRunEvents", () => {
  it("emits a tool event from tool_call_started MCP payloads", () => {
    // Given
    const mcpArgs = concatBytes([encodeStringField(1, "read"), encodeStringField(5, "read")])
    const mcpCall = encodeBytesField(1, mcpArgs)
    const toolCall = encodeBytesField(15, mcpCall)
    const started = concatBytes([
      encodeStringField(1, "call-1"),
      encodeBytesField(2, toolCall),
      encodeStringField(3, "model-call-1"),
    ])
    const message = encodeBytesField(1, encodeBytesField(2, started))

    // When
    const events = extractCursorRunEvents(message)

    // Then
    expect(events).toEqual([{ kind: "tool", callId: "call-1", name: "read", args: {} }])
  })

  it("emits thinking text from thinking_delta updates", () => {
    // Given
    const message = encodeBytesField(1, encodeBytesField(4, encodeStringField(1, "hmm")))

    // When
    const events = extractCursorRunEvents(message)

    // Then
    expect(events).toEqual([{ kind: "thinking", text: "hmm" }])
  })

  it("emits turn-ended from turn_ended updates", () => {
    // Given
    const message = encodeBytesField(1, encodeBytesField(14, new Uint8Array()))

    // When
    const events = extractCursorRunEvents(message)

    // Then
    expect(events).toEqual([{ kind: "turn-ended" }])
  })

  it("emits no event from opaque InteractionUpdate field 25", () => {
    // Given
    const message = encodeBytesField(1, field25Wire0([0x01]))

    // When
    const events = extractCursorRunEvents(message)

    // Then
    expect(events).toEqual([])
  })

  it("emits only semantic text when field 25 coexists with a text update", () => {
    // Given
    const interactionUpdate = concatBytes([
      field25Wire0([0x01]),
      encodeBytesField(1, encodeStringField(1, "semantic text")),
    ])
    const message = encodeBytesField(1, interactionUpdate)

    // When
    const events = extractCursorRunEvents(message)

    // Then
    expect(events).toEqual([{ kind: "text", text: "semantic text" }])
  })

  it("emits only semantic thinking when field 25 coexists with a thinking update", () => {
    // Given
    const interactionUpdate = concatBytes([
      encodeBytesField(4, encodeStringField(1, "semantic thinking")),
      field25Wire0([0x81, 0x00]),
    ])
    const message = encodeBytesField(1, interactionUpdate)

    // When
    const events = extractCursorRunEvents(message)

    // Then
    expect(events).toEqual([{ kind: "thinking", text: "semantic thinking" }])
  })
})
