import { describe, expect, it } from "bun:test"

import { InvalidArgumentError } from "../../../../src/core/errors"
import { createXaiAuthorityObserver } from "../../../../src/providers/xai/authority-observer"
import { FakeClock } from "../../../support/clock"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../../support/process"

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe("xAI authority boundaries", () => {
  it.each([undefined, "", "relative"])("allocates no resources when HOME is %s", async (home) => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    let observations = 0
    // When
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: home },
      processSupervisor: supervisor,
      observeSource: async () => {
        observations += 1
        return { kind: "ready", fingerprint: "selected" }
      },
    })
    await flush()
    // Then
    expect(observations).toBe(0)
    expect(clock.pendingCount()).toBe(0)
    expect(supervisor.commands).toHaveLength(0)
    await observer.dispose()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "preserves interval validation even when disabled for %s",
    (value) => {
      // Given
      const options = {
        enabled: false,
        clock: new FakeClock(),
        env: {},
        processSupervisor: new FakeProcessSupervisor(),
      }
      // When / Then
      expect(() => createXaiAuthorityObserver({ ...options, pollMs: value })).toThrow(
        InvalidArgumentError,
      )
      expect(() => createXaiAuthorityObserver({ ...options, retryMs: value })).toThrow(
        InvalidArgumentError,
      )
    },
  )

  it.each(["[]", "null", "{", "read-error"])(
    "retries a failed V1 observation %s with the default five-second delay",
    async (input) => {
      // Given
      const clock = new FakeClock()
      const supervisor = new FakeProcessSupervisor()
      const child = new FakeSupervisedProcess()
      supervisor.enqueueProcess(child)
      let raw: string = input
      const observer = createXaiAuthorityObserver({
        enabled: true,
        clock,
        env: { HOME: "/home/test" },
        processSupervisor: supervisor,
        readAuthFile: async () => {
          if (raw === "read-error") throw new Error("synthetic read failure")
          return raw
        },
      })
      await flush()
      // When
      raw = "{}"
      clock.advanceBy(4_999)
      await flush()
      expect(supervisor.commands).toHaveLength(0)
      clock.advanceBy(1)
      await flush()
      // Then
      expect(supervisor.commands).toHaveLength(1)
      child.complete({ kind: "code", code: 0 })
      await observer.dispose()
    },
  )

  it("serializes reads and helper waits then polls unchanged state after one second", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const child = new FakeSupervisedProcess()
    const pending = Promise.withResolvers<string>()
    supervisor.enqueueProcess(child)
    let reads = 0
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      readAuthFile: async () => {
        reads += 1
        return pending.promise
      },
    })
    // When
    clock.advanceBy(10_000)
    await flush()
    expect(reads).toBe(1)
    pending.resolve("{}")
    await flush()
    clock.advanceBy(10_000)
    await flush()
    expect(reads).toBe(1)
    child.complete({ kind: "code", code: 0 })
    await flush()
    clock.advanceBy(999)
    await flush()
    expect(reads).toBe(1)
    clock.advanceBy(1)
    await flush()
    // Then
    expect(reads).toBe(2)
    expect(supervisor.commands).toHaveLength(1)
    await observer.dispose()
  })

  it.each([
    { kind: "code", code: 9 },
    { kind: "signal", signal: "SIGTERM" },
  ] as const)(
    "retries unsuccessful helper exit %j instead of committing its fingerprint",
    async (exit) => {
      // Given
      const clock = new FakeClock()
      const supervisor = new FakeProcessSupervisor()
      const failed = new FakeSupervisedProcess()
      const recovered = new FakeSupervisedProcess()
      supervisor.enqueueProcess(failed)
      supervisor.enqueueProcess(recovered)
      const observer = createXaiAuthorityObserver({
        enabled: true,
        clock,
        env: { HOME: "/home/test" },
        processSupervisor: supervisor,
        readAuthFile: async () => "{}",
      })
      await flush()
      // When
      failed.complete(exit)
      await flush()
      clock.advanceBy(5_000)
      await flush()
      // Then
      expect(supervisor.commands).toHaveLength(2)
      recovered.complete({ kind: "code", code: 0 })
      await observer.dispose()
    },
  )
})
