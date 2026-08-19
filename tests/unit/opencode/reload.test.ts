import { describe, expect, it } from "bun:test"

import { scheduleCatalogReload } from "../../../src/opencode/reload"
import { FakeClock } from "../../support/clock"

describe("scheduleCatalogReload", () => {
  it("calls reload after each interval", async () => {
    // Given
    const clock = new FakeClock(0)
    let calls = 0
    const handle = scheduleCatalogReload({
      clock,
      intervalMs: 1_000,
      reload: async () => {
        calls += 1
      },
    })
    // When
    clock.advanceBy(1_000)
    clock.advanceBy(1_000)
    await handle.dispose()
    // Then
    expect(calls).toBe(2)
  })

  it("does not schedule when intervalMs is 0", async () => {
    // Given
    const clock = new FakeClock(0)
    let calls = 0
    const handle = scheduleCatalogReload({
      clock,
      intervalMs: 0,
      reload: async () => {
        calls += 1
      },
    })
    // When
    clock.advanceBy(10_000)
    await handle.dispose()
    // Then
    expect(calls).toBe(0)
  })
})
