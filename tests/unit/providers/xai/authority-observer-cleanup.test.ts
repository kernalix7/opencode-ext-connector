import { describe, expect, it } from "bun:test"

import type { Clock } from "../../../../src/core/clock"
import type { ProcessSupervisor, SupervisedProcess } from "../../../../src/core/process"
import { createXaiAuthorityObserver } from "../../../../src/providers/xai/authority-observer"
import { FakeClock } from "../../../support/clock"

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe("xAI authority cleanup faults", () => {
  it("attempts abort and drain after timer cancellation throws", async () => {
    // Given
    const fakeClock = new FakeClock()
    const fault = new Error("synthetic timer fault")
    const clock: Clock = {
      nowMs: () => fakeClock.nowMs(),
      schedule: (delay, callback) => {
        const timer = fakeClock.schedule(delay, callback)
        return {
          cancel: () => {
            timer.cancel()
            throw fault
          },
          [Symbol.dispose]: () => timer.cancel(),
        }
      },
    }
    let signal: AbortSignal | undefined
    const child: SupervisedProcess = {
      wait: async () => ({ kind: "code", code: 0 }),
      terminate: async () => {},
      dispose: async () => {},
      [Symbol.asyncDispose]: async () => {},
    }
    const supervisor: ProcessSupervisor = {
      start: async (_command, observedSignal) => {
        signal = observedSignal
        return child
      },
      dispose: async () => {},
      [Symbol.asyncDispose]: async () => {},
    }
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      readAuthFile: async () => "{}",
    })
    await flush()
    // When
    const result = await observer.dispose().then(
      () => undefined,
      (error: unknown) => error,
    )
    // Then
    if (!(result instanceof AggregateError)) throw new Error("expected cleanup failure")
    expect(result.errors).toEqual([fault])
    expect(signal?.aborted).toBe(true)
    expect(fakeClock.pendingCount()).toBe(0)
  })

  it("retains both late-child termination and disposal faults while draining spawn", async () => {
    // Given
    const clock = new FakeClock()
    const pending = Promise.withResolvers<SupervisedProcess>()
    const terminationFault = new Error("synthetic termination fault")
    const disposalFault = new Error("synthetic disposal fault")
    let disposals = 0
    let waits = 0
    const child: SupervisedProcess = {
      wait: async () => {
        waits += 1
        return { kind: "code", code: 0 }
      },
      terminate: async () => {
        throw terminationFault
      },
      dispose: async () => {
        disposals += 1
        throw disposalFault
      },
      [Symbol.asyncDispose]: async () => {},
    }
    const supervisor: ProcessSupervisor = {
      start: async () => pending.promise,
      dispose: async () => {},
      [Symbol.asyncDispose]: async () => {},
    }
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      readAuthFile: async () => "{}",
    })
    await flush()
    // When
    const disposal = observer.dispose()
    await flush()
    pending.resolve(child)
    const result = await disposal.then(
      () => undefined,
      (error: unknown) => error,
    )
    // Then
    if (!(result instanceof AggregateError)) throw new Error("expected cleanup failure")
    expect(result.errors).toContain(terminationFault)
    expect(result.errors).toContain(disposalFault)
    expect(disposals).toBe(1)
    expect(waits).toBe(0)
    expect(clock.pendingCount()).toBe(0)
  })
})
