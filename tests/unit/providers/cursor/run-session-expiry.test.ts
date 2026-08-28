import { describe, expect, it } from "bun:test"

import {
  CursorRunSessionError,
  createCursorRunSessionRegistry,
} from "../../../../src/providers/cursor/run-session"
import { CursorRunSessionTtlCleanupError } from "../../../../src/providers/cursor/run-session-expiry"
import { FakeClock } from "../../../support/clock"
import { cursorRunSessionResources } from "../../../support/cursor-run-session"

async function drainBackgroundWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe("Cursor Run session expiry", () => {
  it("reports failed TTL cleanup once without an unhandled rejection", async () => {
    // Given
    const clock = new FakeClock()
    const attempts: string[] = []
    const reports: CursorRunSessionTtlCleanupError[] = []
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    const base = cursorRunSessionResources({ key: "expiring-session", callIds: ["call-1"] })
    const registry = createCursorRunSessionRegistry({
      clock,
      ttlMs: 10,
      onBackgroundCleanupError: (error): void => {
        reports.push(error)
      },
    })
    const session = registry.register({
      ...base,
      stream: {
        ...base.stream,
        close: async () => {
          attempts.push("close")
          throw new Error("close failed")
        },
      },
      ownership: {
        ...base.ownership,
        release: (): void => {
          attempts.push("ownership")
          throw new Error("ownership failed")
        },
      },
      disposeStores: (): void => {
        attempts.push("stores")
        throw new Error("stores failed")
      },
    })
    session.touch()

    try {
      // When
      clock.advanceBy(10)
      await drainBackgroundWork()

      // Then
      expect(attempts).toEqual(["close", "ownership", "stores"])
      expect(registry.size()).toBe(0)
      expect(clock.pendingCount()).toBe(0)
      expect(() => registry.resolveParkedCalls(["call-1"], "model")).toThrow(CursorRunSessionError)
      expect(reports).toHaveLength(1)
      const report = reports[0]
      expect(report).toBeInstanceOf(CursorRunSessionTtlCleanupError)
      if (!(report instanceof CursorRunSessionTtlCleanupError)) {
        throw new TypeError("missing typed TTL cleanup report")
      }
      expect(report.cause).toBeInstanceOf(AggregateError)
      expect(report.cause.errors).toHaveLength(3)
      expect(report).toMatchObject({
        name: "CursorRunSessionTtlCleanupError",
        code: "CURSOR_RUN_SESSION_TTL_CLEANUP_ERROR",
        operation: "ttl-expiration",
        identity: session.identity,
      })
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
      await registry.dispose()
    }
  })

  it("settles a rejecting TTL cleanup reporter without an unhandled rejection", async () => {
    // Given
    const clock = new FakeClock()
    const reports: CursorRunSessionTtlCleanupError[] = []
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    const base = cursorRunSessionResources({ key: "reporter-session", callIds: ["call-1"] })
    const registry = createCursorRunSessionRegistry({
      clock,
      ttlMs: 10,
      onBackgroundCleanupError: async (error): Promise<void> => {
        reports.push(error)
        throw new Error("reporter failed")
      },
    })
    const session = registry.register({
      ...base,
      stream: {
        ...base.stream,
        close: async () => {
          throw new Error("close failed")
        },
      },
    })
    session.touch()

    try {
      // When
      clock.advanceBy(10)
      await drainBackgroundWork()

      // Then
      expect(reports).toHaveLength(1)
      expect(registry.size()).toBe(0)
      expect(clock.pendingCount()).toBe(0)
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
      await registry.dispose()
    }
  })
})
