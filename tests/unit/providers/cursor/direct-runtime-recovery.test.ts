import { describe, expect, it } from "bun:test"

import type {
  CursorBridgeClient,
  CursorBridgeStream,
} from "../../../../src/providers/cursor/bridge-client"
import {
  decodeConnectFramesStrict,
  encodeConnectFrame,
} from "../../../../src/providers/cursor/connect-frame"
import { createCursorDirectRuntime } from "../../../../src/providers/cursor/direct-runtime"
import { decodeAgentClientMessage } from "../../../../src/providers/cursor/proto/request"
import { encodeAgentServerMessage } from "../../../../src/providers/cursor/proto/server"
import { CursorRecoveryError } from "../../../../src/providers/cursor/recovery"
import { FakeClock } from "../../../support/clock"

function ids(): () => string {
  let next = 0
  return (): string => `recovery-${++next}`
}

function protocolFailureFixture(payload: Uint8Array): {
  readonly runtime: ReturnType<typeof createCursorDirectRuntime>
  readonly openCount: () => number
} {
  let opens = 0
  const open = async (): Promise<CursorBridgeStream> => {
    opens += 1
    return {
      id: `protocol-failure-${opens}`,
      write: async () => undefined,
      nextEvent: async () => ({
        kind: "data",
        id: `protocol-failure-${opens}`,
        payload,
      }),
      abort: async () => undefined,
      close: async () => undefined,
    }
  }
  const dispose = async (): Promise<void> => undefined
  const client: CursorBridgeClient = {
    pid: 1,
    open,
    dispose,
    [Symbol.asyncDispose]: dispose,
  }
  return {
    runtime: createCursorDirectRuntime({
      clock: new FakeClock(),
      createId: ids(),
      readAccessToken: async () => "token",
      onBackgroundCleanupError: () => undefined,
      createBridgeClient: async () => client,
    }),
    openCount: () => opens,
  }
}

async function captureStreamFailure(stream: ReadableStream<unknown>): Promise<CursorRecoveryError> {
  const failure = await Array.fromAsync(stream).then(
    () => new TypeError("expected Cursor stream failure"),
    (error: unknown) => error,
  )
  if (!(failure instanceof CursorRecoveryError)) {
    throw new TypeError("expected CursorRecoveryError")
  }
  return failure
}

describe("Cursor direct runtime recovery", () => {
  it("surfaces allowlisted Connect-frame protocol diagnostics without retrying", async () => {
    // Given
    const secret = "secret-sentinel-connect-frame"
    const fixture = protocolFailureFixture(
      encodeConnectFrame(new TextEncoder().encode(secret), { endStream: true }),
    )

    // When
    const result = await fixture.runtime.doStream(
      { prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] },
      "auto",
    )
    const failure = await captureStreamFailure(result.stream)

    // Then
    expect(failure.reason).toBe("non-retryable")
    expect(failure.retryable).toBe(false)
    expect(failure.attemptedModes).toEqual(["initial"])
    expect(failure.protocolFailure).toEqual({
      reason: "malformed",
      context: "Connect end-stream",
      stage: "connect-frame",
    })
    expect(JSON.stringify(failure.protocolFailure)).not.toContain(secret)
    expect(fixture.openCount()).toBe(1)
    await fixture.runtime.dispose()
  })

  it("surfaces allowlisted server-dispatch protocol diagnostics without retrying", async () => {
    // Given
    const fixture = protocolFailureFixture(encodeConnectFrame(Uint8Array.from([0x0a, 0x01])))

    // When
    const result = await fixture.runtime.doStream(
      { prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] },
      "auto",
    )
    const failure = await captureStreamFailure(result.stream)

    // Then
    expect(failure.reason).toBe("non-retryable")
    expect(failure.retryable).toBe(false)
    expect(failure.attemptedModes).toEqual(["initial"])
    expect(failure.protocolFailure).toEqual({
      reason: "truncated",
      context: "AgentServerMessage",
      stage: "server-dispatch",
    })
    expect(fixture.openCount()).toBe(1)
    await fixture.runtime.dispose()
  })

  it("retries checkpoint before a fresh full call with one outward stream", async () => {
    // Given
    const clock = new FakeClock()
    const writes: Uint8Array[][] = []
    const waiting = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    let opens = 0
    const open = async (): Promise<CursorBridgeStream> => {
      const attempt = opens
      opens += 1
      const attemptWrites: Uint8Array[] = []
      writes.push(attemptWrites)
      let events = 0
      return {
        id: `stream-${attempt}`,
        write: async (payload) => {
          attemptWrites.push(new Uint8Array(payload))
        },
        nextEvent: async (signal) => {
          if (attempt === 0 && events === 0) {
            events += 1
            const frame = decodeConnectFramesStrict(attemptWrites[0] ?? new Uint8Array()).at(0)
            if (frame === undefined) throw new TypeError("missing initial request")
            const request = decodeAgentClientMessage(frame.bytes)
            if (request.kind !== "run-request") throw new TypeError("expected Run request")
            return {
              kind: "data" as const,
              id: `stream-${attempt}`,
              payload: encodeConnectFrame(
                encodeAgentServerMessage({
                  kind: "conversation-checkpoint-update",
                  checkpoint: request.request.conversationState,
                }),
              ),
            }
          }
          if (attempt === 2) {
            return {
              kind: "data" as const,
              id: "stream-2",
              payload: encodeConnectFrame(
                encodeAgentServerMessage({
                  kind: "interaction-update",
                  update: { kind: "turn-ended" },
                }),
              ),
            }
          }
          waiting[attempt]?.resolve()
          if (signal === undefined) throw new TypeError("watchdog signal is required")
          return await new Promise((resolve, reject) => {
            const onAbort = (): void => reject(signal.reason)
            signal.addEventListener("abort", onAbort, { once: true })
            void Promise.resolve().then(() => {
              if (signal.aborted) onAbort()
            })
            void resolve
          })
        },
        abort: async () => undefined,
        close: async () => undefined,
      }
    }
    const dispose = async (): Promise<void> => undefined
    const client: CursorBridgeClient = {
      pid: 1,
      open,
      dispose,
      [Symbol.asyncDispose]: dispose,
    }
    const runtime = createCursorDirectRuntime({
      clock,
      createId: ids(),
      idleTimeoutMs: 10,
      readAccessToken: async () => "token",
      onBackgroundCleanupError: () => undefined,
      createBridgeClient: async () => client,
    })
    const result = await runtime.doStream(
      { prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] },
      "auto",
    )
    const parts = Array.fromAsync(result.stream)
    await waiting[0]?.promise

    // When
    clock.advanceBy(10)
    await waiting[1]?.promise
    clock.advanceBy(10)

    // Then
    const output = await parts
    const requests = writes.map((attemptWrites) => {
      const frame = decodeConnectFramesStrict(attemptWrites[0] ?? new Uint8Array()).at(0)
      if (frame === undefined) throw new TypeError("missing Run request frame")
      const request = decodeAgentClientMessage(frame.bytes)
      if (request.kind !== "run-request") throw new TypeError("expected Run request")
      return request.request
    })
    expect(requests.map((request) => request.action.kind)).toEqual([
      "user-message",
      "resume",
      "user-message",
    ])
    expect(new Set(requests.map((request) => request.conversationId)).size).toBe(1)
    expect(output.filter((part) => part.type === "stream-start")).toHaveLength(1)
    expect(output.filter((part) => part.type === "finish")).toHaveLength(1)
    expect(clock.pendingCount()).toBe(0)
    await runtime.dispose()
  })
})
