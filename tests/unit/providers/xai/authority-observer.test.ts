import { describe, expect, it } from "bun:test"
import { createXaiAuthorityObserver } from "../../../../src/providers/xai/authority-observer"
import { FakeClock } from "../../../support/clock"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../../support/process"

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe("xAI authority observer", () => {
  it("invokes initially and only for committed xAI changes or removal", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const first = new FakeSupervisedProcess()
    const second = new FakeSupervisedProcess()
    const third = new FakeSupervisedProcess()
    supervisor.enqueueProcess(first)
    supervisor.enqueueProcess(second)
    supervisor.enqueueProcess(third)
    let auth = JSON.stringify({ xai: { key: "synthetic-a" }, other: 1 })
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      pollMs: 100,
      readAuthFile: async () => auth,
    })
    await flush()
    expect(supervisor.commands).toHaveLength(1)
    first.complete({ kind: "code", code: 0 })
    await flush()

    // When
    auth = JSON.stringify({ xai: { key: "synthetic-a" }, other: 2 })
    clock.advanceBy(100)
    await flush()
    auth = JSON.stringify({ xai: { key: "synthetic-b" }, other: 2 })
    clock.advanceBy(100)
    await flush()
    second.complete({ kind: "code", code: 0 })
    await flush()
    auth = JSON.stringify({ other: 2 })
    clock.advanceBy(100)
    await flush()

    // Then
    expect(supervisor.commands).toHaveLength(3)
    third.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })

  it("passes a fixed helper and only allowlisted environment, never credentials", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    supervisor.enqueueProcess(new FakeSupervisedProcess())
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: {
        HOME: "/home/test",
        XDG_DATA_HOME: "/data/test",
        XAI_API_KEY: "host-secret",
        HTTPS_PROXY: "host-proxy",
      },
      processSupervisor: supervisor,
      readAuthFile: async () => "{}",
    })
    await flush()

    // When / Then
    expect(supervisor.commands).toEqual([
      {
        executable: "/home/test/.local/bin/opensandbox-xai-auth-sync",
        arguments: [],
        cwd: null,
        environment: {
          HOME: "/home/test",
          PATH: "/usr/local/bin:/usr/bin:/bin",
          XDG_DATA_HOME: "/data/test",
        },
      },
    ])
    await observer.dispose()
  })

  it("does not read or schedule with disabled or relative authority environment", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    let reads = 0
    // When
    const disabled = createXaiAuthorityObserver({
      enabled: false,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      readAuthFile: async () => {
        reads += 1
        return "{}"
      },
    })
    const relative = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test", XDG_DATA_HOME: "relative" },
      processSupervisor: supervisor,
      readAuthFile: async () => {
        reads += 1
        return "{}"
      },
    })
    await flush()
    // Then
    expect(reads).toBe(0)
    expect(clock.pendingCount()).toBe(0)
    expect(supervisor.commands).toHaveLength(0)
    await Promise.all([disabled.dispose(), relative.dispose()])
  })

  it("retries malformed source and helper contention, then polls after success", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    supervisor.enqueueProcess(new FakeSupervisedProcess())
    let raw = "{"
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      pollMs: 100,
      retryMs: 250,
      readAuthFile: async () => raw,
    })
    await flush()
    expect(supervisor.commands).toHaveLength(0)
    // When
    raw = "{}"
    clock.advanceBy(249)
    await flush()
    expect(supervisor.commands).toHaveLength(0)
    clock.advanceBy(1)
    await flush()
    // Then
    expect(supervisor.commands).toHaveLength(1)
    await observer.dispose()
  })

  it("reads the first V1 auth path and treats missing auth as a committed removal", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const child = new FakeSupervisedProcess()
    supervisor.enqueueProcess(child)
    const paths: string[] = []
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test", XDG_DATA_HOME: "/data/test" },
      processSupervisor: supervisor,
      readAuthFile: async (path) => {
        paths.push(path)
        return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }))
      },
    })
    await flush()
    // When / Then
    expect(paths).toEqual(["/data/test/opencode/auth.json"])
    expect(supervisor.commands).toHaveLength(1)
    child.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })

  it("uses the injected observation exclusively, including retry and unchanged fingerprint", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const first = new FakeSupervisedProcess()
    const second = new FakeSupervisedProcess()
    supervisor.enqueueProcess(first)
    supervisor.enqueueProcess(second)
    let fingerprint = "selected-a"
    let retries = true
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      pollMs: 100,
      retryMs: 250,
      readAuthFile: async () => {
        throw new Error("V1 read forbidden")
      },
      observeSource: async () => (retries ? { kind: "retry" } : { kind: "ready", fingerprint }),
    })
    await flush()
    // When
    retries = false
    clock.advanceBy(250)
    await flush()
    first.complete({ kind: "code", code: 0 })
    await flush()
    clock.advanceBy(100)
    await flush()
    fingerprint = "selected-b"
    clock.advanceBy(100)
    await flush()
    // Then
    expect(supervisor.commands).toHaveLength(2)
    second.complete({ kind: "code", code: 0 })
    await observer.dispose()
  })
})
