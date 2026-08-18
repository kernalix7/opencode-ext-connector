import { describe, expect, it } from "bun:test"

import { createDeadline } from "../../../src/core/deadline"
import {
  DeadlineExceededError,
  OperationCancelledError,
  ResourceDisposedError,
} from "../../../src/core/errors"
import { FakeClock } from "../../support/clock"

describe("createDeadline", () => {
  it("expires at the exact fake-clock deadline", () => {
    // Given
    const clock = new FakeClock(10)
    const deadline = createDeadline({ clock, timeoutMs: 5, parentSignal: null })
    // When
    clock.advanceBy(5)
    // Then
    expect(deadline.signal.reason).toBeInstanceOf(DeadlineExceededError)
    expect(deadline.remainingMs()).toBe(0)
  })

  it("propagates parent cancellation with a typed reason", () => {
    // Given
    const clock = new FakeClock()
    const parent = new AbortController()
    const deadline = createDeadline({ clock, timeoutMs: 10, parentSignal: parent.signal })
    // When
    parent.abort("secret")
    // Then
    expect(deadline.signal.reason).toBeInstanceOf(OperationCancelledError)
    expect(clock.pendingCount()).toBe(0)
  })

  it("aborts on disposal and cancels scheduled work", async () => {
    // Given
    const clock = new FakeClock()
    const deadline = createDeadline({ clock, timeoutMs: 10, parentSignal: null })
    // When
    await deadline.dispose()
    // Then
    expect(deadline.signal.reason).toBeInstanceOf(ResourceDisposedError)
    expect(clock.pendingCount()).toBe(0)
  })

  it("aborts zero-duration deadlines synchronously", () => {
    // Given
    const clock = new FakeClock()
    // When
    const deadline = createDeadline({ clock, timeoutMs: 0, parentSignal: null })
    // Then
    expect(deadline.signal.aborted).toBe(true)
  })
})
