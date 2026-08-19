import { describe, expect, it } from "bun:test"

import { commandCodeToolParts } from "../../../../src/providers/command-code/tool-stream"

describe("commandCodeToolParts", () => {
  it("returns empty array for text-delta", () => {
    // Given
    const parsed = { type: "text-delta", text: "hello" }
    // When
    const parts = commandCodeToolParts(parsed)
    // Then
    expect(parts).toEqual([])
  })

  it("tool-call-delta with name emits tool-input-start and tool-input-delta", () => {
    // Given
    const parsed = {
      type: "tool-call-delta",
      data: { toolCallId: "t1", name: "Read", arguments: '{"p"' },
    }
    // When
    const parts = commandCodeToolParts(parsed)
    // Then
    expect(parts).toEqual([
      { type: "tool-input-start", id: "t1", toolName: "Read" },
      { type: "tool-input-delta", id: "t1", delta: '{"p"' },
    ])
  })

  it("tool-call with nested data emits tool-input-end and tool-call", () => {
    // Given
    const parsed = {
      type: "tool-call",
      data: { toolCallId: "t1", toolName: "Read", input: { path: "a.ts" } },
    }
    // When
    const parts = commandCodeToolParts(parsed)
    // Then
    expect(parts).toEqual([
      { type: "tool-input-end", id: "t1" },
      { type: "tool-call", toolCallId: "t1", toolName: "Read", input: '{"path":"a.ts"}' },
    ])
  })

  it("flat tool-call with toolCallId, name, arguments works", () => {
    // Given
    const parsed = {
      type: "tool-call",
      toolCallId: "t2",
      name: "Write",
      arguments: '{"path":"b.ts","content":"x"}',
    }
    // When
    const parts = commandCodeToolParts(parsed)
    // Then
    expect(parts).toEqual([
      { type: "tool-input-end", id: "t2" },
      {
        type: "tool-call",
        toolCallId: "t2",
        toolName: "Write",
        input: '{"path":"b.ts","content":"x"}',
      },
    ])
  })

  it("tool-call-delta without name emits only tool-input-delta", () => {
    // Given
    const parsed = {
      type: "tool-call-delta",
      data: { toolCallId: "t3", arguments: '{"p":' },
    }
    // When
    const parts = commandCodeToolParts(parsed)
    // Then
    expect(parts).toEqual([{ type: "tool-input-delta", id: "t3", delta: '{"p":' }])
  })

  it("unknown type returns empty array", () => {
    // Given
    const parsed = { type: "unknown", foo: "bar" }
    // When
    const parts = commandCodeToolParts(parsed)
    // Then
    expect(parts).toEqual([])
  })
})
