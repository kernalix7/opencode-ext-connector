import { describe, expect, it } from "bun:test"

import { encodeConnectFrame } from "../../../../src/providers/cursor/connect-frame"
import { CursorDirectStreamError } from "../../../../src/providers/cursor/direct-stream"
import type { CursorDispatchResult } from "../../../../src/providers/cursor/server-dispatch"
import { concatenate, directFixture } from "../../../support/cursor-direct-stream-fixture"

function turnEnded(): CursorDispatchResult {
  return { outcome: { kind: "turn-ended" }, replyFrames: [], closeStream: false }
}

describe("Cursor direct stream round-2 regressions", () => {
  it("prefers a non-empty canonical toolName over the legacy name", async () => {
    // Given
    const fixture = directFixture({
      events: [
        { kind: "data", id: "stream-round2", payload: encodeConnectFrame(Uint8Array.of(1)) },
      ],
      dispatchBytes: () => ({
        outcome: {
          kind: "mcp-parked",
          parked: {
            callId: "call-1",
            execId: "exec-1",
            execMessageId: 1,
            args: {
              name: "legacy-name",
              toolName: "canonical-name",
              toolCallId: "call-1",
              providerIdentifier: "provider-1",
              args: { path: "/tmp/example" },
            },
          },
        },
        replyFrames: [],
        closeStream: false,
      }),
    })

    // When
    const parts = await fixture.parts

    // Then
    expect(parts).toContainEqual(
      expect.objectContaining({ type: "tool-call", toolName: "canonical-name" }),
    )
  })

  it("preserves Connect end-stream error diagnostics", async () => {
    // Given
    const payload = new TextEncoder().encode(
      JSON.stringify({ error: { code: "internal", message: "upstream failed" } }),
    )
    const fixture = directFixture({
      events: [
        {
          kind: "data",
          id: "stream-round2",
          payload: encodeConnectFrame(payload, { endStream: true }),
        },
      ],
    })

    // When
    let failure: unknown
    try {
      await fixture.parts
    } catch (error) {
      failure = error
    }

    // Then
    expect(failure).toBeInstanceOf(CursorDirectStreamError)
    if (!(failure instanceof CursorDirectStreamError)) throw failure
    expect(failure.bridgeCode).toBe("internal")
    expect(failure.bridgeMessage).toBe("upstream failed")
  })

  it("preserves bridge event error diagnostics", async () => {
    // Given
    const fixture = directFixture({
      events: [
        {
          kind: "error",
          id: "stream-round2",
          code: "session-goaway",
          message: "upstream sent GOAWAY",
        },
      ],
    })

    // When
    let failure: unknown
    try {
      await fixture.parts
    } catch (error) {
      failure = error
    }

    // Then
    expect(failure).toBeInstanceOf(CursorDirectStreamError)
    if (!(failure instanceof CursorDirectStreamError)) throw failure
    expect(failure.bridgeCode).toBe("session-goaway")
    expect(failure.bridgeMessage).toBe("upstream sent GOAWAY")
  })

  it("accepts a clean protobuf turn-ended frame", async () => {
    // Given
    const fixture = directFixture({
      events: [
        { kind: "data", id: "stream-round2", payload: encodeConnectFrame(Uint8Array.of(1)) },
      ],
      dispatchBytes: turnEnded,
    })

    // When
    const parts = await fixture.parts

    // Then
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "stop" } })
    expect(fixture.terminateCount()).toBe(1)
  })

  it("rejects a complete frame after protobuf turn-ended in the same chunk", async () => {
    // Given
    const payload = concatenate([
      encodeConnectFrame(Uint8Array.of(1)),
      encodeConnectFrame(Uint8Array.of(2)),
    ])
    const fixture = directFixture({
      events: [{ kind: "data", id: "stream-round2", payload }],
      dispatchBytes: turnEnded,
    })

    // When
    const result = fixture.parts

    // Then
    await expect(result).rejects.toBeInstanceOf(CursorDirectStreamError)
    expect(fixture.abortCount()).toBe(1)
    expect(fixture.terminateCount()).toBe(0)
  })

  it("accepts output and turn-ended before a successful Connect end-stream", async () => {
    // Given
    const outputPayload = Uint8Array.of(1)
    const turnEndedPayload = Uint8Array.of(2)
    const payload = concatenate([
      encodeConnectFrame(outputPayload),
      encodeConnectFrame(turnEndedPayload),
      encodeConnectFrame(new TextEncoder().encode("{}"), { endStream: true }),
    ])
    const fixture = directFixture({
      events: [{ kind: "data", id: "stream-round2", payload }],
      dispatchBytes: (bytes) => {
        if (bytes[0] === outputPayload[0]) {
          return {
            outcome: { kind: "text", text: "OK" },
            replyFrames: [],
            closeStream: false,
          }
        }
        if (bytes[0] === turnEndedPayload[0]) return turnEnded()
        throw new TypeError("unexpected dispatch")
      },
    })

    // When
    const parts = await fixture.parts

    // Then
    const textIndex = parts.findIndex((part) => part.type === "text-delta")
    const finishIndex = parts.findIndex((part) => part.type === "finish")
    expect(parts[textIndex]).toMatchObject({ type: "text-delta", delta: "OK" })
    expect(finishIndex).toBeGreaterThan(textIndex)
    expect(parts[finishIndex]).toMatchObject({
      type: "finish",
      finishReason: { unified: "stop" },
    })
    expect(fixture.abortCount()).toBe(0)
    expect(fixture.terminateCount()).toBe(1)
  })

  it("rejects partial bytes after protobuf turn-ended in the same chunk", async () => {
    // Given
    const partial = encodeConnectFrame(Uint8Array.of(2, 3)).subarray(0, 6)
    const payload = concatenate([encodeConnectFrame(Uint8Array.of(1)), partial])
    const fixture = directFixture({
      events: [{ kind: "data", id: "stream-round2", payload }],
      dispatchBytes: turnEnded,
    })

    // When
    const result = fixture.parts

    // Then
    await expect(result).rejects.toThrow("trailing partial")
    expect(fixture.abortCount()).toBe(1)
    expect(fixture.terminateCount()).toBe(0)
  })

  it("aggregates the primary stream failure before an abort-cleanup failure", async () => {
    // Given
    const cleanupError = new Error("abort cleanup failed")
    const fixture = directFixture({
      events: [
        {
          kind: "error",
          id: "stream-round2",
          code: "primary-code",
          message: "primary failed",
        },
      ],
      abortError: cleanupError,
    })

    // When
    let failure: unknown
    try {
      await fixture.parts
    } catch (error) {
      failure = error
    }

    // Then
    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) throw failure
    expect(failure.errors).toHaveLength(2)
    expect(failure.errors[0]).toBeInstanceOf(CursorDirectStreamError)
    expect(failure.errors[0]).toMatchObject({
      bridgeCode: "primary-code",
      bridgeMessage: "primary failed",
    })
    expect(failure.errors[1]).toBe(cleanupError)
  })
})
