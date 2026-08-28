import { describe, expect, it } from "bun:test"

import { OperationCancelledError } from "../../../../src/core/errors"
import {
  CursorRecoveryError,
  createCursorIdleWatchdog,
  createCursorRecoveryPlanner,
} from "../../../../src/providers/cursor/recovery"
import { FakeClock } from "../../../support/clock"

describe("Cursor recovery planner", () => {
  it("uses one checkpoint before one history retry and then exhausts", () => {
    // Given
    const planner = createCursorRecoveryPlanner()
    const replay = { outputEpoch: 0, checkpointEpoch: 0, toolBoundary: false }

    // When
    const checkpoint = planner.next({ checkpointAvailable: true, replay, retryable: true })
    const history = planner.next({ checkpointAvailable: true, replay, retryable: true })
    const exhausted = planner.next({ checkpointAvailable: true, replay, retryable: true })

    // Then
    expect(checkpoint).toEqual({ kind: "retry", mode: "checkpoint" })
    expect(history).toEqual({ kind: "retry", mode: "history" })
    expect(exhausted).toEqual({ kind: "fail", reason: "exhausted" })
    expect(() => planner.requireRetry(exhausted, new TypeError("idle"))).toThrow(
      CursorRecoveryError,
    )
  })

  it("skips checkpoint when none covers the current output epoch", () => {
    // Given
    const planner = createCursorRecoveryPlanner()

    // When
    const decision = planner.next({
      checkpointAvailable: false,
      replay: { outputEpoch: 0, checkpointEpoch: null, toolBoundary: false },
      retryable: true,
    })

    // Then
    expect(decision).toEqual({ kind: "retry", mode: "history" })
  })

  it("fails rather than replaying exposed output without a covering checkpoint", () => {
    // Given
    const planner = createCursorRecoveryPlanner()

    // When
    const decision = planner.next({
      checkpointAvailable: true,
      replay: { outputEpoch: 2, checkpointEpoch: 1, toolBoundary: false },
      retryable: true,
    })

    // Then
    expect(decision).toEqual({ kind: "fail", reason: "replay-unsafe" })
  })
})

describe("Cursor idle watchdog", () => {
  it("resets on progress, ignores heartbeat, parks without a timer, and aborts waiters", () => {
    // Given
    const clock = new FakeClock()
    const parent = new AbortController()
    const watchdog = createCursorIdleWatchdog({
      clock,
      idleTimeoutMs: 10,
      parentSignal: parent.signal,
    })

    // When
    clock.advanceBy(9)
    watchdog.heartbeat()
    clock.advanceBy(1)

    // Then
    expect(watchdog.signal.aborted).toBe(true)
    expect(watchdog.signal.reason).toBeInstanceOf(CursorRecoveryError)

    // Given
    const second = createCursorIdleWatchdog({
      clock,
      idleTimeoutMs: 10,
      parentSignal: parent.signal,
    })

    // When
    clock.advanceBy(9)
    second.progress()
    clock.advanceBy(9)

    // Then
    expect(second.signal.aborted).toBe(false)
    expect(clock.pendingCount()).toBe(1)

    // When
    second.park()

    // Then
    expect(clock.pendingCount()).toBe(0)

    // Given
    const thirdParent = new AbortController()
    const third = createCursorIdleWatchdog({
      clock,
      idleTimeoutMs: 10,
      parentSignal: thirdParent.signal,
    })

    // When
    thirdParent.abort()

    // Then
    expect(third.signal.aborted).toBe(true)
    expect(third.signal.reason).toBeInstanceOf(OperationCancelledError)
    expect(clock.pendingCount()).toBe(0)
  })
})
