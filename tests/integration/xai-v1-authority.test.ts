import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startV1XaiAuthority } from "../../src/opencode/xai-v1-host"
import { FakeClock } from "../support/clock"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../support/process"

describe("V1 xAI authority owner", () => {
  it("disposes an allocated supervisor when observer construction fails", async () => {
    // Given
    const supervisor = new FakeProcessSupervisor()
    const failure = new TypeError("environment lookup failed")
    let closed = false
    // When
    const startup = startV1XaiAuthority({
      env: {
        get HOME(): string {
          throw failure
        },
      },
      clock: new FakeClock(),
      createSupervisor: () => ({
        start: (command, signal) => supervisor.start(command, signal),
        dispose: async () => {
          closed = true
          await supervisor.dispose()
        },
        [Symbol.asyncDispose]: () => supervisor.dispose(),
      }),
    })
    // Then
    await expect(startup).rejects.toBe(failure)
    expect(closed).toBe(true)
    expect(supervisor.commands).toEqual([])
  })

  it("closes its supervisor even when observer timer cancellation fails", async () => {
    // Given
    const home = await mkdtemp(join(tmpdir(), "xai-v1-authority-"))
    const clock = new FakeClock()
    const scheduled = Promise.withResolvers<void>()
    const supervisor = new FakeProcessSupervisor()
    const process = new FakeSupervisedProcess()
    process.complete({ kind: "code", code: 0 })
    supervisor.enqueueProcess(process)
    let supervisorClosed = false
    try {
      await mkdir(join(home, "opencode"))
      await writeFile(join(home, "opencode", "auth.json"), "{}")
      const owner = await startV1XaiAuthority({
        env: { HOME: home, XDG_DATA_HOME: home },
        clock: {
          nowMs: () => clock.nowMs(),
          schedule: (delay, callback) => {
            const timer = clock.schedule(delay, callback)
            scheduled.resolve()
            const cancel = (): void => {
              timer.cancel()
              throw new TypeError("timer cancellation failure")
            }
            return { cancel, [Symbol.dispose]: cancel }
          },
        },
        createSupervisor: () => ({
          start: (command, signal) => supervisor.start(command, signal),
          dispose: async () => {
            supervisorClosed = true
            await supervisor.dispose()
          },
          [Symbol.asyncDispose]: () => supervisor.dispose(),
        }),
      })
      await scheduled.promise
      // When
      const closed = owner.dispose()
      // Then
      await expect(closed).rejects.toBeInstanceOf(AggregateError)
      expect(owner.dispose()).toBe(closed)
      expect(supervisorClosed).toBe(true)
      expect(clock.pendingCount()).toBe(0)
      expect(supervisor.commands).toEqual([
        {
          executable: join(home, ".local", "bin", "opensandbox-xai-auth-sync"),
          arguments: [],
          cwd: null,
          environment: { HOME: home, XDG_DATA_HOME: home, PATH: "/usr/local/bin:/usr/bin:/bin" },
        },
      ])
    } finally {
      await supervisor.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })
})
