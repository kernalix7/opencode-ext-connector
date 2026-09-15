import { describe, expect, it } from "bun:test"

import { ProcessSupervisorError } from "../../../../src/core/errors"
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

describe("Claude credential authority invocation", () => {
  it("runs the restricted flock command from XDG state without credential arguments", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const process = new FakeSupervisedProcess()
    const directories: string[] = []
    supervisor.enqueueProcess(process)
    let reads = 0
    const scheduler = createClaudeCredentialAuthorityScheduler({
      enabled: true,
      platform: "linux",
      clock,
      leadMs: 1_000,
      retryMs: 5_000,
      env: { HOME: "/home/test", XDG_STATE_HOME: "/xdg/state" },
      processSupervisor: supervisor,
      logger: createConnectorLogger(clock, new MemoryLogSink()),
      readCredentials: async () => {
        reads += 1
        return credentials(reads === 1 ? 500 : 100_000)
      },
      ensureStateDirectory: async (path) => {
        directories.push(path)
      },
    })
    await flush()

    // When
    process.complete({ kind: "code", code: 0 })
    await flush()

    // Then
    const stateDirectory = "/xdg/state/opencode-ext-connector/claude-credential-authority"
    expect(directories).toEqual([stateDirectory])
    expect(supervisor.commands).toHaveLength(1)
    const command = supervisor.commands[0]
    expect(command?.executable).toBe("flock")
    expect(command?.cwd).toBe(stateDirectory)
    expect(command?.arguments.slice(0, 10)).toEqual([
      "--exclusive",
      "--nonblock",
      "--conflict-exit-code",
      "75",
      "--no-fork",
      "--",
      `${stateDirectory}/authority.lock`,
      "claude",
      "--restricted",
      "-p",
    ])
    expect(command?.arguments[10]?.length).toBeGreaterThan(0)
    expect(command?.arguments.slice(11)).toEqual([
      "--permission-prompts",
      "none",
      "--max-turns",
      "1",
      "--output-format",
      "json",
    ])
    expect(JSON.stringify(command)).not.toContain("secret-access-token")
    expect(JSON.stringify(command)).not.toContain("secret-refresh-token")
    expect(clock.pendingCount()).toBe(1)
    await scheduler.dispose()
  })

  it("uses the HOME state fallback when XDG state is absent", async () => {
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
      readCredentials: async () => credentials(0),
      ensureStateDirectory: async () => undefined,
    })
    await flush()

    // When / Then
    expect(supervisor.commands[0]?.cwd).toBe(
      "/home/test/.local/state/opencode-ext-connector/claude-credential-authority",
    )
    process.complete({ kind: "code", code: 75 })
    await scheduler.dispose()
  })

  it("warns without error detail and retries after process failures", async () => {
    // Given
    const clock = new FakeClock()
    const sink = new MemoryLogSink()
    const supervisor = new FakeProcessSupervisor()
    supervisor.enqueueError(
      new ProcessSupervisorError({
        operation: "spawn",
        retryable: true,
        cause: new Error("secret-access-token"),
      }),
    )
    const retry = new FakeSupervisedProcess()
    supervisor.enqueueProcess(retry)
    const scheduler = createClaudeCredentialAuthorityScheduler({
      enabled: true,
      platform: "linux",
      clock,
      leadMs: 1_000,
      retryMs: 5_000,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      logger: createConnectorLogger(clock, sink),
      readCredentials: async () => credentials(0),
      ensureStateDirectory: async () => undefined,
    })
    await flush()

    // When
    clock.advanceBy(5_000)
    await flush()

    // Then
    expect(supervisor.commands).toHaveLength(2)
    expect(sink.records).toEqual([
      {
        timestampMs: 0,
        level: "warn",
        event: "claude.credential-authority.process-failed",
        fields: {},
      },
    ])
    expect(JSON.stringify(sink.records)).not.toContain("secret-access-token")
    retry.complete({ kind: "code", code: 75 })
    await scheduler.dispose()
  })

  it("warns for nonzero exits and retries", async () => {
    // Given
    const clock = new FakeClock()
    const sink = new MemoryLogSink()
    const supervisor = new FakeProcessSupervisor()
    const failed = new FakeSupervisedProcess()
    const retry = new FakeSupervisedProcess()
    supervisor.enqueueProcess(failed)
    supervisor.enqueueProcess(retry)
    const scheduler = createClaudeCredentialAuthorityScheduler({
      enabled: true,
      platform: "linux",
      clock,
      leadMs: 1_000,
      retryMs: 5_000,
      env: { HOME: "/home/test" },
      processSupervisor: supervisor,
      logger: createConnectorLogger(clock, sink),
      readCredentials: async () => credentials(0),
      ensureStateDirectory: async () => undefined,
    })
    await flush()
    failed.complete({ kind: "code", code: 9 })
    await flush()

    // When
    clock.advanceBy(5_000)
    await flush()

    // Then
    expect(supervisor.commands).toHaveLength(2)
    expect(sink.records).toEqual([
      {
        timestampMs: 0,
        level: "warn",
        event: "claude.credential-authority.nonzero-exit",
        fields: { exitCode: 9 },
      },
    ])
    retry.complete({ kind: "code", code: 75 })
    await scheduler.dispose()
  })
})
