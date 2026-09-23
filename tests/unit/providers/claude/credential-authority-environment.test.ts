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

describe("Claude credential authority child environment", () => {
  it("omits the API key from every authority invocation without changing the parent", async () => {
    // Given
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const first = new FakeSupervisedProcess()
    const retry = new FakeSupervisedProcess()
    supervisor.enqueueProcess(first)
    supervisor.enqueueProcess(retry)
    const env = Object.freeze({
      HOME: "/home/test",
      EMPTY: "",
      UNSET: undefined,
      ANTHROPIC_API_KEY: "test-api-key",
    })
    const scheduler = createClaudeCredentialAuthorityScheduler({
      enabled: true,
      platform: "linux",
      clock,
      leadMs: 1_000,
      retryMs: 5_000,
      env,
      processSupervisor: supervisor,
      logger: createConnectorLogger(clock, new MemoryLogSink()),
      readCredentials: async () => credentials(0),
      ensureStateDirectory: async () => undefined,
    })
    await flush()
    first.complete({ kind: "code", code: 9 })
    await flush()

    // When
    clock.advanceBy(5_000)
    await flush()

    // Then
    expect(supervisor.commands).toHaveLength(2)
    for (const command of supervisor.commands) {
      expect(command.environment).toEqual({ HOME: "/home/test", EMPTY: "" })
      expect(command).not.toHaveProperty("environment.ANTHROPIC_API_KEY")
      expect(command.environment).not.toHaveProperty("UNSET")
    }
    expect(env.ANTHROPIC_API_KEY).toBe("test-api-key")
    expect(env.UNSET).toBeUndefined()
    expect(env.EMPTY).toBe("")
    retry.complete({ kind: "code", code: 75 })
    await scheduler.dispose()
  })
})
