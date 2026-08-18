import { describe, expect, it } from "bun:test"

import { OperationCancelledError, ResourceDisposedError } from "../../../src/core/errors"
import type { ProcessCommand } from "../../../src/core/process"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../support/process"

const command: ProcessCommand = { executable: "provider", arguments: ["serve"], cwd: null }

describe("fake process supervision", () => {
  it("starts queued processes and records cloned commands", async () => {
    // Given
    const supervisor = new FakeProcessSupervisor()
    const process = new FakeSupervisedProcess()
    supervisor.enqueueProcess(process)
    // When
    const started = await supervisor.start(command, new AbortController().signal)
    // Then
    expect(started).toBe(process)
    expect(supervisor.commands).toEqual([command])
  })

  it("resolves controlled process exits", async () => {
    // Given
    const process = new FakeSupervisedProcess()
    const wait = process.wait(new AbortController().signal)
    // When
    process.complete({ kind: "code", code: 7 })
    // Then
    await expect(wait).resolves.toEqual({ kind: "code", code: 7 })
  })

  it("cancels waits without terminating the process", async () => {
    // Given
    const process = new FakeSupervisedProcess()
    const controller = new AbortController()
    const wait = process.wait(controller.signal)
    // When
    controller.abort()
    // Then
    await expect(wait).rejects.toBeInstanceOf(OperationCancelledError)
    expect(process.terminationCount).toBe(0)
  })

  it("disposes active processes and rejects later starts", async () => {
    // Given
    const supervisor = new FakeProcessSupervisor()
    const process = new FakeSupervisedProcess()
    supervisor.enqueueProcess(process)
    await supervisor.start(command, new AbortController().signal)
    // When
    await supervisor.dispose()
    // Then
    expect(process.terminationCount).toBe(1)
    await expect(supervisor.start(command, new AbortController().signal)).rejects.toBeInstanceOf(
      ResourceDisposedError,
    )
  })
})
