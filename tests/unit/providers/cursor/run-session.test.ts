import { describe, expect, it } from "bun:test"

import {
  CursorRunSessionError,
  createCursorRunSessionRegistry,
} from "../../../../src/providers/cursor/run-session"
import { FakeClock } from "../../../support/clock"
import { cursorRunSessionResources as resources } from "../../../support/cursor-run-session"

const ignoreBackgroundCleanupError = (): void => undefined

describe("createCursorRunSessionRegistry", () => {
  it("writes a matching result once without affecting another session", async () => {
    // Given
    const clock = new FakeClock()
    const registry = createCursorRunSessionRegistry({
      clock,
      ttlMs: 100,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const firstWrites: Uint8Array[] = []
    const secondWrites: Uint8Array[] = []
    const released = { count: 0 }
    const first = registry.register(
      resources({ key: "first", callIds: ["call-a"], writes: firstWrites, released }),
    )
    registry.register(
      resources({ key: "second", callIds: ["call-b"], writes: secondWrites, released }),
    )

    // When
    await first.writeContinuations([{ callId: "call-a", frame: new Uint8Array([1, 2]) }])

    // Then
    expect(firstWrites).toEqual([new Uint8Array([1, 2])])
    expect(secondWrites).toEqual([])
    await expect(
      first.writeContinuations([{ callId: "call-a", frame: new Uint8Array([3]) }]),
    ).rejects.toMatchObject({ reason: "duplicate-result" })
    await registry.dispose()
  })

  it("rejects mismatched results before writing", async () => {
    // Given
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 100,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const writes: Uint8Array[] = []
    const session = registry.register(resources({ key: "first", callIds: ["call-a"], writes }))

    // When
    const result = session.writeContinuations([{ callId: "call-b", frame: new Uint8Array([9]) }])

    // Then
    await expect(result).rejects.toBeInstanceOf(CursorRunSessionError)
    expect(writes).toEqual([])
    await registry.dispose()
  })

  it("rejects ambiguous parked-call ownership", async () => {
    // Given
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 100,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const firstWrites: Uint8Array[] = []
    const secondWrites: Uint8Array[] = []
    const first = registry.register(
      resources({ key: "first", callIds: ["shared-call"], writes: firstWrites }),
    )
    const second = registry.register(
      resources({ key: "second", callIds: ["shared-call"], writes: secondWrites }),
    )
    first.touch()
    second.touch()

    // When
    const resolve = (): void => {
      registry.resolveParkedCalls(["shared-call"], "model")
    }

    // Then
    expect(resolve).toThrow(expect.objectContaining({ reason: "ambiguous-result" }))
    expect(firstWrites).toEqual([])
    expect(secondWrites).toEqual([])
    await registry.dispose()
  })

  it("arms TTL only while parked and cancels it before continuation", async () => {
    // Given
    const clock = new FakeClock()
    const registry = createCursorRunSessionRegistry({
      clock,
      ttlMs: 10,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const write = Promise.withResolvers<void>()
    const session = registry.register(
      resources({ key: "first", callIds: ["call-a"], write: () => write.promise }),
    )
    clock.advanceBy(10)
    await Promise.resolve()
    session.touch()

    // When
    const continuation = session.writeContinuations([
      { callId: "call-a", frame: new Uint8Array([1]) },
    ])
    clock.advanceBy(10)

    // Then
    expect(registry.size()).toBe(1)
    expect(clock.pendingCount()).toBe(0)
    write.resolve()
    await continuation
    await registry.dispose()
  })

  it("reserves a complete continuation set before queued writes", async () => {
    // Given
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 100,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const firstWrite = Promise.withResolvers<void>()
    const writes: Uint8Array[] = []
    const session = registry.register(
      resources({
        key: "first",
        callIds: ["call-a", "call-b"],
        write: async (frame) => {
          writes.push(new Uint8Array(frame))
          if (writes.length === 1) await firstWrite.promise
        },
      }),
    )
    session.touch()

    // When
    const transaction = session.writeContinuations([
      { callId: "call-a", frame: new Uint8Array([1]) },
      { callId: "call-b", frame: new Uint8Array([2]) },
    ])
    const duplicate = session.writeContinuations([{ callId: "call-b", frame: new Uint8Array([3]) }])

    // Then
    await expect(duplicate).rejects.toMatchObject({ reason: "duplicate-result" })
    firstWrite.resolve()
    await transaction
    expect(writes).toEqual([new Uint8Array([1]), new Uint8Array([2])])
    await registry.dispose()
  })

  it("terminates a poisoned session and attempts every cleanup after write failure", async () => {
    // Given
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 100,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const attempts: string[] = []
    let writeCount = 0
    const base = resources({
      key: "first",
      callIds: ["call-a", "call-b"],
      write: async () => {
        writeCount += 1
        if (writeCount === 2) throw new Error("uncertain write")
      },
      close: async () => {
        attempts.push("close")
        throw new Error("close failed")
      },
    })
    const session = registry.register({
      ...base,
      ownership: { ...base.ownership, release: () => attempts.push("ownership") },
      disposeStores: () => attempts.push("stores"),
    })
    session.touch()

    // When
    const transaction = session.writeContinuations([
      { callId: "call-a", frame: new Uint8Array([1]) },
      { callId: "call-b", frame: new Uint8Array([2]) },
    ])

    // Then
    await expect(transaction).rejects.toThrow("uncertain write")
    expect(registry.size()).toBe(0)
    expect(attempts).toEqual(["close", "ownership", "stores"])
    await expect(registry.dispose()).resolves.toBeUndefined()
  })
})
