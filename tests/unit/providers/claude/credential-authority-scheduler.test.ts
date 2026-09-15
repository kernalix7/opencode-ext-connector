import { describe, expect, it } from "bun:test"
import { createConnectorLogger } from "../../../../src/core/logger"
import { createClaudeCredentialAuthorityScheduler } from "../../../../src/providers/claude/credential-authority-scheduler"
import type { ClaudeCredentials } from "../../../../src/providers/claude/credentials"
import { FakeClock } from "../../../support/clock"
import { MemoryLogSink } from "../../../support/log-sink"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../../support/process"

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

function credentials(expiresAtMs: number): ClaudeCredentials {
  return {
    accessToken: "secret-access-token",
    refreshToken: "secret-refresh-token",
    expiresAtMs,
  }
}

describe("Claude credential authority scheduling", () => {
  it("stays inert unless enabled on Linux", async () => {
    // Given
    const clock = new FakeClock()
    let reads = 0
    const create = (enabled: boolean, platform: string) =>
      createClaudeCredentialAuthorityScheduler({
        enabled,
        platform,
        clock,
        leadMs: 1_000,
        retryMs: 5_000,
        env: { HOME: "/home/test" },
        processSupervisor: new FakeProcessSupervisor(),
        logger: createConnectorLogger(clock, new MemoryLogSink()),
        readCredentials: async () => {
          reads += 1
          return credentials(0)
        },
        ensureStateDirectory: async () => undefined,
      })

    // When
    const disabled = create(false, "linux")
    const unsupported = create(true, "darwin")
    await flush()

    // Then
    expect(reads).toBe(0)
    expect(clock.pendingCount()).toBe(0)
    await Promise.all([disabled.dispose(), unsupported.dispose()])
  })

  it("evaluates immediately and rearms at the credential lead boundary", async () => {
    // Given
    const clock = new FakeClock(10_000)
    const supervisor = new FakeProcessSupervisor()
    const process = new FakeSupervisedProcess()
    supervisor.enqueueProcess(process)
    const scheduler = createClaudeCredentialAuthorityScheduler({
      enabled: true,
      platform: "linux",
      clock,
      leadMs: 2_000,
      retryMs: 5_000,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      logger: createConnectorLogger(clock, new MemoryLogSink()),
      readCredentials: async () => credentials(15_000),
      ensureStateDirectory: async () => undefined,
    })
    await flush()

    // When
    clock.advanceBy(2_999)
    await flush()

    // Then
    expect(supervisor.commands).toEqual([])
    clock.advanceBy(1)
    await flush()
    expect(supervisor.commands).toHaveLength(1)
    process.complete({ kind: "code", code: 75 })
    await scheduler.dispose()
  })

  it("retries after credentials are missing", async () => {
    // Given
    const clock = new FakeClock()
    let reads = 0
    const scheduler = createClaudeCredentialAuthorityScheduler({
      enabled: true,
      platform: "linux",
      clock,
      leadMs: 1_000,
      retryMs: 5_000,
      env: { HOME: "/home/test" },
      processSupervisor: new FakeProcessSupervisor(),
      logger: createConnectorLogger(clock, new MemoryLogSink()),
      readCredentials: async () => {
        reads += 1
        return null
      },
      ensureStateDirectory: async () => undefined,
    })
    await flush()

    // When
    clock.advanceBy(5_000)
    await flush()

    // Then
    expect(reads).toBe(2)
    expect(clock.pendingCount()).toBe(1)
    await scheduler.dispose()
  })

  it("treats lock contention as benign and retries", async () => {
    // Given
    const clock = new FakeClock()
    const sink = new MemoryLogSink()
    const supervisor = new FakeProcessSupervisor()
    const first = new FakeSupervisedProcess()
    const second = new FakeSupervisedProcess()
    supervisor.enqueueProcess(first)
    supervisor.enqueueProcess(second)
    const scheduler = createClaudeCredentialAuthorityScheduler({
      enabled: true,
      platform: "linux",
      clock,
      leadMs: 1_000,
      retryMs: 5_000,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      logger: createConnectorLogger(clock, sink),
      readCredentials: async () => credentials(500),
      ensureStateDirectory: async () => undefined,
    })
    await flush()
    first.complete({ kind: "code", code: 75 })
    await flush()

    // When
    clock.advanceBy(5_000)
    await flush()

    // Then
    expect(supervisor.commands).toHaveLength(2)
    expect(sink.records.filter(({ level }) => level === "warn")).toEqual([])
    second.complete({ kind: "code", code: 75 })
    await scheduler.dispose()
  })

  it("cancels a running authority process during disposal", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const process = new FakeSupervisedProcess()
    supervisor.enqueueProcess(process)
    const scheduler = createClaudeCredentialAuthorityScheduler({
      enabled: true,
      platform: "linux",
      clock,
      leadMs: 1_000,
      retryMs: 5_000,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      logger: createConnectorLogger(clock, new MemoryLogSink()),
      readCredentials: async () => credentials(500),
      ensureStateDirectory: async () => undefined,
    })
    await flush()

    // When
    await scheduler.dispose()

    // Then
    expect(process.terminationCount).toBe(1)
    expect(clock.pendingCount()).toBe(0)
  })
})
