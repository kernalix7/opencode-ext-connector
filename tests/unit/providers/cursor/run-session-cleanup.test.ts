import { describe, expect, it } from "bun:test"

import type { CursorBridgeStream } from "../../../../src/providers/cursor/bridge-client"
import { createCursorRunSessionRegistry } from "../../../../src/providers/cursor/run-session"
import type {
  CursorServerDispatcher,
  ParkedMcpCall,
} from "../../../../src/providers/cursor/server-dispatch"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

const ignoreBackgroundCleanupError = (): void => undefined

function cleanupResources(attempts: string[], parked = false, fails = true, onStores?: () => void) {
  const parkedCalls = new Map<string, ParkedMcpCall>()
  if (parked) {
    parkedCalls.set("call-1", {
      callId: "call-1",
      execId: "exec-1",
      execMessageId: 1,
      args: {
        name: "read",
        args: {},
        toolCallId: "call-1",
        providerIdentifier: "opencode",
        toolName: "read",
      },
    })
  }
  const fail = (name: string) => async (): Promise<void> => {
    attempts.push(name)
    if (fails) throw new Error(`${name} failed`)
  }
  const stream: CursorBridgeStream = {
    id: "cleanup-stream",
    write: async () => undefined,
    nextEvent: async () => ({ kind: "end", id: "cleanup-stream" }),
    abort: fail("abort"),
    close: fail("close"),
  }
  const dispatcher: CursorServerDispatcher = {
    dispatch: () => {
      throw new Error("unused")
    },
    dispatchBytes: () => {
      throw new Error("unused")
    },
    parkedCalls,
  }
  return {
    sessionId: parseCursorSessionId("cleanup-session"),
    modelId: "auto",
    stream,
    dispatcher,
    ownership: {
      blobIds: [],
      release: (): void => {
        attempts.push("ownership")
        if (fails) throw new Error("ownership failed")
      },
      [Symbol.dispose]: () => undefined,
    },
    disposeStores: (): void => {
      attempts.push("stores")
      onStores?.()
      if (fails) throw new Error("stores failed")
    },
  }
}

describe("Cursor Run session cleanup", () => {
  it("attempts close, ownership release, and store disposal when each fails", async () => {
    // Given
    const attempts: string[] = []
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 10,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const session = registry.register(cleanupResources(attempts))

    // When
    const disposal = registry.terminate(session.identity)

    // Then
    await expect(disposal).rejects.toBeInstanceOf(AggregateError)
    expect(attempts).toEqual(["close", "ownership", "stores"])
    await expect(registry.dispose()).resolves.toBeUndefined()
  })

  it("attempts abort, ownership release, and store disposal when each fails", async () => {
    // Given
    const attempts: string[] = []
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 10,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const session = registry.register(cleanupResources(attempts))

    // When
    const abortion = session.abort()

    // Then
    await expect(abortion).rejects.toBeInstanceOf(AggregateError)
    expect(attempts).toEqual(["abort", "ownership", "stores"])
    await expect(registry.dispose()).resolves.toBeUndefined()
  })

  it("keeps an active Run past TTL and expires a parked Run at TTL", async () => {
    // Given
    const clock = new FakeClock()
    const attempts: string[] = []
    const cleaned = Promise.withResolvers<void>()
    const registry = createCursorRunSessionRegistry({
      clock,
      ttlMs: 10,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const session = registry.register(cleanupResources(attempts, true, false, cleaned.resolve))
    clock.advanceBy(10)

    // When
    session.touch()
    clock.advanceBy(10)
    await cleaned.promise

    // Then
    expect(registry.size()).toBe(0)
    expect(attempts).toEqual(["close", "ownership", "stores"])
    expect(clock.pendingCount()).toBe(0)
    await expect(registry.dispose()).resolves.toBeUndefined()
  })
})
