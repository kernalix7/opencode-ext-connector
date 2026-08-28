import { describe, expect, it } from "bun:test"

import { createCursorStreamAdapter } from "../../../../src/providers/cursor/stream-adapter"
import { emptyCursorUsage } from "../../../../src/providers/cursor/usage"

describe("Cursor outward stream adapter", () => {
  it("keeps one stream lifecycle and balanced sections across attempts", async () => {
    // Given
    const adapter = createCursorStreamAdapter()
    const parts = Array.fromAsync(adapter.stream)

    // When
    adapter.emit({ kind: "thinking", text: "plan" })
    adapter.noteCheckpoint()
    adapter.suspendForRetry()
    adapter.emit({ kind: "text", text: "answer" })
    adapter.finish("stop")

    // Then
    expect(await parts).toEqual([
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", delta: "plan" },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "answer" },
      { type: "text-end", id: "text-2" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: emptyCursorUsage(),
      },
    ])
    expect(adapter.replayState()).toEqual({
      outputEpoch: 2,
      checkpointEpoch: 1,
      toolBoundary: false,
    })
  })
})
