import { describe, expect, it } from "bun:test"

import { scheduleCatalogReload } from "../../../src/opencode/reload"
import { FakeClock } from "../../support/clock"

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("scheduleCatalogReload", () => {
  it("calls reload after each fixed delay", async () => {
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
    await flush()
    clock.advanceBy(1_000)
    await flush()
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

  it("uses fixed delay without overlapping reloads", async () => {
    // Given
    const clock = new FakeClock(0)
    const first = Promise.withResolvers<void>()
    let calls = 0
    const handle = scheduleCatalogReload({
      clock,
      intervalMs: 1_000,
      reload: async () => {
        calls += 1
        await first.promise
      },
    })

    // When
    clock.advanceBy(2_000)
    await Promise.resolve()

    // Then
    expect(calls).toBe(1)
    expect(clock.pendingCount()).toBe(0)

    first.resolve()
    await flush()
    expect(clock.pendingCount()).toBe(1)
    clock.advanceBy(999)
    expect(calls).toBe(1)
    clock.advanceBy(1)
    await handle.dispose()
    expect(calls).toBe(2)
  })

  it("awaits the active reload during idempotent disposal", async () => {
    // Given
    const clock = new FakeClock(0)
    const active = Promise.withResolvers<void>()
    const handle = scheduleCatalogReload({
      clock,
      intervalMs: 1,
      reload: () => active.promise,
    })
    clock.advanceBy(1)
    await Promise.resolve()

    // When
    let disposed = false
    const firstDispose = handle.dispose().then(() => {
      disposed = true
    })
    const secondDispose = handle.dispose()
    await Promise.resolve()

    // Then
    expect(disposed).toBe(false)
    active.resolve()
    await Promise.all([firstDispose, secondDispose])
    expect(clock.pendingCount()).toBe(0)
  })
})
