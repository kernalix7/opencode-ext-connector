import { describe, expect, it } from "bun:test"
import { ProcessSupervisorError } from "../../../../src/core/errors"
import type {
  ProcessCommand,
  ProcessSupervisor,
  SupervisedProcess,
} from "../../../../src/core/process"
import { createXaiAuthorityObserver } from "../../../../src/providers/xai/authority-observer"
import { FakeClock } from "../../../support/clock"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../../support/process"

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe("xAI authority cancellation", () => {
  it("disposes idempotently while cancelling observation and an active helper", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const child = new FakeSupervisedProcess()
    supervisor.enqueueProcess(child)
    let reads = 0
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      pollMs: 100,
      retryMs: 250,
      readAuthFile: async () => {
        reads += 1
        return "{}"
      },
    })
    await flush()
    // When
    await Promise.all([observer.dispose(), observer.dispose()])
    clock.advanceBy(1_000)
    await flush()
    // Then
    expect(child.terminationCount).toBe(1)
    expect(reads).toBe(1)
    expect(clock.pendingCount()).toBe(0)
  })

  it("blocks a resolved observation as soon as disposal is requested", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      observeSource: async () => ({ kind: "ready", fingerprint: "selected" }),
    })
    // When
    await observer.dispose()
    // Then
    expect(supervisor.commands).toHaveLength(0)
    expect(clock.pendingCount()).toBe(0)
  })

  it("terminates and disposes a child returned after disposal began, draining the start", async () => {
    // Given
    const clock = new FakeClock()
    const child = new FakeSupervisedProcess()
    const pending = Promise.withResolvers<SupervisedProcess>()
    let starts = 0
    const supervisor: ProcessSupervisor = {
      start: async (_command: ProcessCommand, _signal: AbortSignal) => {
        starts += 1
        return pending.promise
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
    const first = observer.dispose()
    const second = observer.dispose()
    expect(first).toBe(second)
    pending.resolve(child)
    await first
    clock.advanceBy(10_000)
    await flush()
    // Then
    expect(starts).toBe(1)
    expect(child.terminationCount).toBe(1)
    expect(clock.pendingCount()).toBe(0)
  })

  it("retries a failed spawn and code 75 before committing the fingerprint", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const contention = new FakeSupervisedProcess()
    const success = new FakeSupervisedProcess()
    supervisor.enqueueError(
      new ProcessSupervisorError({ operation: "spawn", retryable: true, cause: null }),
    )
    supervisor.enqueueProcess(contention)
    supervisor.enqueueProcess(success)
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      retryMs: 250,
      readAuthFile: async () => "{}",
    })
    await flush()
    // When
    clock.advanceBy(250)
    await flush()
    contention.complete({ kind: "code", code: 75 })
    await flush()
    clock.advanceBy(250)
    await flush()
    // Then
    expect(supervisor.commands).toHaveLength(3)
    success.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })

  it("drains a pending read on disposal without spawning after it resolves", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const pending = Promise.withResolvers<string>()
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      readAuthFile: async () => pending.promise,
    })
    // When
    const disposal = observer.dispose()
    await flush()
    pending.resolve("{}")
    await disposal
    // Then
    expect(supervisor.commands).toHaveLength(0)
    expect(clock.pendingCount()).toBe(0)
  })

  it("attempts process disposal after termination fails and preserves the failure", async () => {
    // Given
    const clock = new FakeClock()
    let disposed = 0
    const child: SupervisedProcess = {
      wait: async (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
        ),
      terminate: async () => {
        throw new Error("termination failed")
      },
      dispose: async () => {
        disposed += 1
      },
      [Symbol.asyncDispose]: async () => {
        disposed += 1
      },
    }
    const supervisor: ProcessSupervisor = {
      start: async () => child,
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
    // Then
    await expect(disposal).rejects.toThrow("xAI authority disposal failed")
    expect(disposed).toBe(1)
  })
})
