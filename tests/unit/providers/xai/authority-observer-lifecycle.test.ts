import { describe, expect, it } from "bun:test"

import { OperationCancelledError, ProcessSupervisorError } from "../../../../src/core/errors"
import type { ProcessSupervisor, SupervisedProcess } from "../../../../src/core/process"
import { createXaiAuthorityObserver } from "../../../../src/providers/xai/authority-observer"
import { FakeClock } from "../../../support/clock"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../../support/process"

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe("xAI authority lifecycle regressions", () => {
  it("retries a rejected selected-source observation without reading V1", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const child = new FakeSupervisedProcess()
    supervisor.enqueueProcess(child)
    let reads = 0
    let observations = 0
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      readAuthFile: async () => {
        reads += 1
        return "{}"
      },
      observeSource: async () => {
        observations += 1
        if (observations === 1) throw new Error("synthetic source unavailable")
        return { kind: "ready", fingerprint: "selected" }
      },
    })
    await flush()
    // When
    clock.advanceBy(5_000)
    await flush()
    // Then
    expect(supervisor.commands).toHaveLength(1)
    expect(reads).toBe(0)
    child.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })

  it("retries an ordinary spawn rejection with the legacy input contract", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const child = new FakeSupervisedProcess()
    supervisor.enqueueError(new Error("synthetic spawn failure"))
    supervisor.enqueueProcess(child)
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      readAuthFile: async () => "{}",
    })
    await flush()
    // When
    clock.advanceBy(5_000)
    await flush()
    // Then
    expect(supervisor.commands).toHaveLength(2)
    child.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })

  it("preserves a typed child cleanup fault instead of retrying it as a spawn failure", async () => {
    // Given
    const clock = new FakeClock()
    const fault = new ProcessSupervisorError({
      operation: "cleanup",
      retryable: false,
      cause: null,
    })
    const child: SupervisedProcess = {
      wait: async () => ({ kind: "code", code: 0 }),
      terminate: async () => {},
      dispose: async () => {
        throw fault
      },
      [Symbol.asyncDispose]: async () => {
        throw fault
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
    const result = await observer.dispose().then(
      () => undefined,
      (error: unknown) => error,
    )
    // Then
    expect(result).toBeInstanceOf(AggregateError)
    if (!(result instanceof AggregateError)) throw new Error("expected cleanup failure")
    expect(result.errors).toContain(fault)
    expect(clock.pendingCount()).toBe(0)
  })

  it("drains evaluation and disposes the child even when terminate throws synchronously", async () => {
    // Given
    const clock = new FakeClock()
    const fault = new Error("synthetic synchronous termination fault")
    let disposed = 0
    const child: SupervisedProcess = {
      wait: async (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new OperationCancelledError("wait-process")),
            { once: true },
          )
        }),
      terminate: () => {
        throw fault
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
    const result = await observer.dispose().then(
      () => undefined,
      (error: unknown) => error,
    )
    // Then
    expect(result).toBeInstanceOf(AggregateError)
    if (!(result instanceof AggregateError)) throw new Error("expected cleanup failure")
    expect(result.errors).toContain(fault)
    expect(disposed).toBe(1)
    expect(clock.pendingCount()).toBe(0)
  })
})
