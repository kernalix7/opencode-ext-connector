import { describe, expect, it } from "bun:test"

import { InvalidArgumentError } from "../../../src/core/errors"
import { FakeClock } from "../../support/clock"

describe("FakeClock", () => {
  it("runs due callbacks in FIFO order", () => {
    // Given
    const clock = new FakeClock(100)
    const calls: string[] = []
    clock.schedule(10, () => void calls.push("first"))
    clock.schedule(10, () => void calls.push("second"))
    // When
    clock.advanceBy(10)
    // Then
    expect(calls).toEqual(["first", "second"])
    expect(clock.nowMs()).toBe(110)
  })

  it("runs nested callbacks due at the current instant", () => {
    // Given
    const clock = new FakeClock()
    const calls: string[] = []
    clock.schedule(5, () => {
      calls.push("outer")
      clock.schedule(0, () => void calls.push("inner"))
    })
    // When
    clock.advanceBy(5)
    // Then
    expect(calls).toEqual(["outer", "inner"])
  })

  it("cancels callbacks idempotently", () => {
    // Given
    const clock = new FakeClock()
    let calls = 0
    const scheduled = clock.schedule(1, () => {
      calls += 1
    })
    // When
    scheduled.cancel()
    scheduled[Symbol.dispose]()
    clock.advanceBy(1)
    // Then
    expect(calls).toBe(0)
  })

  it("rejects invalid delays", () => {
    // Given
    const clock = new FakeClock()
    const delays = [-1, 0.5, Number.POSITIVE_INFINITY]
    // When
    const schedules = delays.map((delay) => () => clock.schedule(delay, () => undefined))
    // Then
    for (const schedule of schedules) expect(schedule).toThrow(InvalidArgumentError)
  })
})
