import { describe, expect, it } from "bun:test"

import {
  calculateBackoffMs,
  createInitialHealthState,
  reduceHealth,
} from "../../../src/core/health"

const policy = { initialBackoffMs: 100, maximumBackoffMs: 350 }

describe("provider health", () => {
  it("starts unknown and becomes ready without retry", () => {
    // Given
    const initial = createInitialHealthState()
    // When
    const ready = reduceHealth(initial, { status: "ready", atMs: 10 }, policy)
    // Then
    expect(ready).toEqual({ status: "ready", consecutiveFailures: 0, retryAtMs: null })
  })

  it("increments failures and schedules capped backoff", () => {
    // Given
    const initial = createInitialHealthState()
    const once = reduceHealth(initial, { status: "stale", atMs: 1_000 }, policy)
    // When
    const twice = reduceHealth(once, { status: "unavailable", atMs: 2_000 }, policy)
    // Then
    expect(once).toEqual({ status: "stale", consecutiveFailures: 1, retryAtMs: 1_100 })
    expect(twice).toEqual({ status: "unavailable", consecutiveFailures: 2, retryAtMs: 2_200 })
  })

  it("caps very large backoff calculations", () => {
    // Given
    const failures = Number.MAX_SAFE_INTEGER
    // When
    const delay = calculateBackoffMs(failures, policy)
    // Then
    expect(delay).toBe(350)
  })
})
