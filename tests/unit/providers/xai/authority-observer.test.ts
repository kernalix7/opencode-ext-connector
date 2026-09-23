import { describe, expect, it } from "bun:test"

import { createXaiAuthorityObserver } from "../../../../src/providers/xai/authority-observer"
import { FakeClock } from "../../../support/clock"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../../support/process"

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe("xAI authority observer", () => {
  it("invokes initially and only when the committed xAI record changes", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const initial = new FakeSupervisedProcess()
    const changed = new FakeSupervisedProcess()
    const removed = new FakeSupervisedProcess()
    supervisor.enqueueProcess(initial)
    supervisor.enqueueProcess(changed)
    supervisor.enqueueProcess(removed)
    let authJson = JSON.stringify({ xai: { type: "api", key: "record-a" }, other: { value: 1 } })
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/authority" },
      processSupervisor: supervisor,
      pollMs: 100,
      retryMs: 250,
      readAuthFile: async () => authJson,
    })
    await flush()
    initial.complete({ kind: "code", code: 0 })
    await flush()

    // When
    authJson = JSON.stringify({ xai: { type: "api", key: "record-a" }, other: { value: 2 } })
    clock.advanceBy(100)
    await flush()
    authJson = JSON.stringify({ xai: { type: "api", key: "record-b" }, other: { value: 2 } })
    clock.advanceBy(100)
    await flush()
    changed.complete({ kind: "code", code: 0 })
    await flush()
    authJson = JSON.stringify({ other: { value: 2 } })
    clock.advanceBy(100)
    await flush()

    // Then
    expect(supervisor.commands).toHaveLength(3)
    removed.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })

  it("uses one fixed no-argument helper with an exact sanitized environment", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const process = new FakeSupervisedProcess()
    supervisor.enqueueProcess(process)
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: {
        HOME: "/home/authority",
        XDG_DATA_HOME: "/data/authority",
        XAI_API_KEY: "hostile-parent-token",
        HTTPS_PROXY: "http://proxy.invalid",
      },
      processSupervisor: supervisor,
      pollMs: 100,
      retryMs: 250,
      readAuthFile: async () => JSON.stringify({ xai: { type: "api", key: "record-a" } }),
    })
    await flush()

    // When / Then
    expect(supervisor.commands).toEqual([
      {
        executable: "/home/authority/.local/bin/opensandbox-xai-auth-sync",
        arguments: [],
        cwd: null,
        environment: {
          HOME: "/home/authority",
          PATH: "/usr/local/bin:/usr/bin:/bin",
          XDG_DATA_HOME: "/data/authority",
        },
      },
    ])
    expect(JSON.stringify(supervisor.commands)).not.toContain("hostile-parent-token")
    expect(JSON.stringify(supervisor.commands)).not.toContain("proxy.invalid")
    process.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })

  it("fails closed before reading auth or invoking the helper when XDG_DATA_HOME is relative", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const readPaths: string[] = []

    // When
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/authority", XDG_DATA_HOME: "relative/data" },
      processSupervisor: supervisor,
      readAuthFile: async (path) => {
        readPaths.push(path)
        return JSON.stringify({ xai: { type: "api", key: "record-a" } })
      },
    })
    await flush()

    // Then
    expect(readPaths).toEqual([])
    expect(supervisor.commands).toEqual([])
    expect(clock.pendingCount()).toBe(0)
    await observer.dispose()
  })

  it("retries benign contention and nonzero exits with the injected clock", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const contention = new FakeSupervisedProcess()
    const failed = new FakeSupervisedProcess()
    const recovered = new FakeSupervisedProcess()
    supervisor.enqueueProcess(contention)
    supervisor.enqueueProcess(failed)
    supervisor.enqueueProcess(recovered)
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/authority" },
      processSupervisor: supervisor,
      pollMs: 100,
      retryMs: 250,
      readAuthFile: async () => JSON.stringify({ xai: { type: "api", key: "record-a" } }),
    })
    await flush()
    contention.complete({ kind: "code", code: 75 })
    await flush()

    // When
    clock.advanceBy(250)
    await flush()
    failed.complete({ kind: "code", code: 9 })
    await flush()
    clock.advanceBy(250)
    await flush()

    // Then
    expect(supervisor.commands).toHaveLength(3)
    recovered.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })

  it("disposes idempotently while cancelling observation and an active helper", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const process = new FakeSupervisedProcess()
    supervisor.enqueueProcess(process)
    let reads = 0
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/authority" },
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
    expect(process.terminationCount).toBe(1)
    expect(reads).toBe(1)
    expect(clock.pendingCount()).toBe(0)
  })
})
