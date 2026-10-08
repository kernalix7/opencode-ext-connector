import { describe, expect, it } from "bun:test"

import { setupV2Connector } from "../../../src/opencode/v2-setup"
import { FakeClock } from "../../support/clock"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../support/process"
import { createV2Host, credentialConnection } from "./v2-host"

async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
}

describe("V2 xAI selected-source authority", () => {
  it("synchronizes initial absence, changes to presence and absence, but not repeated absence", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: [], xaiOAuth: { mode: "authority" } } })
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    for (let index = 0; index < 4; index += 1) {
      const child = new FakeSupervisedProcess()
      child.complete({ kind: "code", code: 0 })
      supervisor.enqueueProcess(child)
    }
    const dispose = await setupV2Connector(host, {
      env: { HOME: "/home/test", XDG_DATA_HOME: "/data/test", XAI_API_KEY: "not-selected" },
      clock,
      createXaiSupervisor: () => supervisor,
    })
    await flush()
    expect(supervisor.commands).toHaveLength(1)
    clock.advanceBy(1_000)
    await flush()
    expect(supervisor.commands).toHaveLength(1)

    // When
    host.setConnection("xai", credentialConnection("selected", "key"))
    host.setKey("selected", "selected-value")
    clock.advanceBy(1_000)
    await flush()
    host.setConnection("xai", undefined)
    clock.advanceBy(1_000)
    await flush()
    clock.advanceBy(1_000)
    await flush()
    host.setConnection("xai", credentialConnection("selected", "key"))
    clock.advanceBy(1_000)
    await flush()

    // Then
    expect(supervisor.commands).toHaveLength(4)
    expect(supervisor.commands[0]).toEqual({
      executable: "/home/test/.local/bin/opensandbox-xai-auth-sync",
      arguments: [],
      cwd: null,
      environment: {
        HOME: "/home/test",
        PATH: "/usr/local/bin:/usr/bin:/bin",
        XDG_DATA_HOME: "/data/test",
      },
    })
    await dispose()
    expect(clock.pendingCount()).toBe(0)
  })

  it("retries observation errors rather than treating them as selected absence", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: [], xaiOAuth: { mode: "authority" } } })
    host.failActive(new Error("selected observation unavailable"))
    const clock = new FakeClock()
    const supervisor = new FakeProcessSupervisor()
    const dispose = await setupV2Connector(host, {
      env: { HOME: "/home/test" },
      clock,
      createXaiSupervisor: () => supervisor,
    })
    await flush()
    // When
    clock.advanceBy(1_000)
    await flush()
    // Then
    expect(supervisor.commands).toEqual([])
    clock.advanceBy(4_000)
    await flush()
    expect(supervisor.commands).toEqual([])
    await dispose()
    expect(clock.pendingCount()).toBe(0)
  })

  it("rolls back a supervised authority when later host registration fails", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: [], xaiOAuth: { mode: "authority" } } })
    const child = new FakeSupervisedProcess()
    const supervisor = new FakeProcessSupervisor()
    supervisor.enqueueProcess(child)
    let disposedSupervisor = false
    const disposeSupervisor = async (): Promise<void> => {
      disposedSupervisor = true
      await supervisor.dispose()
    }
    const failing = {
      ...host,
      integration: {
        ...host.integration,
        transform: async (_callback: Parameters<typeof host.integration.transform>[0]) => {
          await flush()
          throw new Error("host registration failed")
        },
      },
    }
    // When
    await expect(
      setupV2Connector(failing, {
        env: { HOME: "/home/test" },
        clock: new FakeClock(),
        createXaiSupervisor: () => ({
          start: (command, signal) => supervisor.start(command, signal),
          dispose: disposeSupervisor,
          [Symbol.asyncDispose]: disposeSupervisor,
        }),
      }),
    ).rejects.toThrow("host registration failed")
    // Then
    expect(child.terminationCount).toBe(1)
    expect(disposedSupervisor).toBe(true)
  })
})
