import { describe, expect, it } from "bun:test"

import {
  InvalidArgumentError,
  OperationCancelledError,
  ResourceDisposedError,
} from "../../../src/core/errors"
import type { ProcessCommand, ProcessExit } from "../../../src/core/process"
import {
  createProductionProcessSupervisor,
  type ProcessSpawn,
  type ProcessSpawnOptions,
  type SpawnedChild,
} from "../../../src/process/production-supervisor"

class FakeSpawnedChild implements SpawnedChild {
  public exitCode: number | null = null
  public signalCode: string | null = null
  public readonly killSignals: string[] = []
  private readonly spawnListeners = new Set<() => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly exitListeners = new Set<(exit: ProcessExit) => void>()

  public onSpawn(listener: () => void): () => void {
    this.spawnListeners.add(listener)
    return () => this.spawnListeners.delete(listener)
  }
  public onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }
  public onExit(listener: (exit: ProcessExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }
  public kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.killSignals.push(signal)
    this.complete({ kind: "signal", signal })
    return true
  }
  public emitSpawn(): void {
    for (const listener of this.spawnListeners) listener()
  }
  public emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
  public complete(exit: ProcessExit): void {
    switch (exit.kind) {
      case "code":
        this.exitCode = exit.code
        break
      case "signal":
        this.signalCode = exit.signal
        break
      default:
        throw new InvalidArgumentError("processExit", exit)
    }
    for (const listener of this.exitListeners) listener(exit)
  }
}

const command: ProcessCommand = {
  executable: "flock",
  arguments: ["--exclusive", "lock", "--", "provider"],
  cwd: "/state/provider",
}

describe("production process supervision", () => {
  it("spawns argv directly while ignoring all child streams", async () => {
    // Given
    const child = new FakeSpawnedChild()
    const calls: { readonly command: ProcessCommand; readonly options: ProcessSpawnOptions }[] = []
    const spawn: ProcessSpawn = (input, options) => {
      calls.push({ command: input, options })
      return child
    }
    const supervisor = createProductionProcessSupervisor({ spawn })

    // When
    const starting = supervisor.start(command, new AbortController().signal)
    child.emitSpawn()
    const process = await starting
    child.complete({ kind: "code", code: 0 })

    // Then
    await expect(process.wait(new AbortController().signal)).resolves.toEqual({
      kind: "code",
      code: 0,
    })
    expect(calls).toEqual([
      {
        command,
        options: { shell: false, stdio: "ignore", windowsHide: true },
      },
    ])
  })

  it("maps spawn failures without exposing child output", async () => {
    // Given
    const child = new FakeSpawnedChild()
    const supervisor = createProductionProcessSupervisor({ spawn: () => child })

    // When
    const starting = supervisor.start(command, new AbortController().signal)
    child.emitError(new Error("spawn denied"))

    // Then
    await expect(starting).rejects.toMatchObject({
      name: "ProcessSupervisorError",
      operation: "spawn",
      retryable: true,
    })
  })

  it("cancels a wait without terminating its child", async () => {
    // Given
    const child = new FakeSpawnedChild()
    const supervisor = createProductionProcessSupervisor({ spawn: () => child })
    const starting = supervisor.start(command, new AbortController().signal)
    child.emitSpawn()
    const process = await starting
    const controller = new AbortController()
    const waiting = process.wait(controller.signal)

    // When
    controller.abort()

    // Then
    await expect(waiting).rejects.toBeInstanceOf(OperationCancelledError)
    expect(child.killSignals).toEqual([])
  })

  it("terminates active children once and rejects starts after disposal", async () => {
    // Given
    const child = new FakeSpawnedChild()
    const supervisor = createProductionProcessSupervisor({ spawn: () => child })
    const starting = supervisor.start(command, new AbortController().signal)
    child.emitSpawn()
    await starting

    // When
    await Promise.all([supervisor.dispose(), supervisor.dispose()])

    // Then
    expect(child.killSignals).toEqual(["SIGTERM"])
    await expect(supervisor.start(command, new AbortController().signal)).rejects.toBeInstanceOf(
      ResourceDisposedError,
    )
  })

  it("rejects an already-cancelled start before spawning", async () => {
    // Given
    let spawnCalls = 0
    const supervisor = createProductionProcessSupervisor({
      spawn: () => {
        spawnCalls += 1
        return new FakeSpawnedChild()
      },
    })
    const controller = new AbortController()
    controller.abort()

    // When / Then
    await expect(supervisor.start(command, controller.signal)).rejects.toBeInstanceOf(
      OperationCancelledError,
    )
    expect(spawnCalls).toBe(0)
  })

  it("terminates a child when cancellation wins its spawn race", async () => {
    // Given
    const child = new FakeSpawnedChild()
    const supervisor = createProductionProcessSupervisor({ spawn: () => child })
    const controller = new AbortController()
    const starting = supervisor.start(command, controller.signal)

    // When
    controller.abort()

    // Then
    await expect(starting).rejects.toBeInstanceOf(OperationCancelledError)
    expect(child.killSignals).toEqual(["SIGTERM"])
  })

  it("settles a pending start when the supervisor is disposed", async () => {
    // Given
    const child = new FakeSpawnedChild()
    const supervisor = createProductionProcessSupervisor({ spawn: () => child })
    let outcome = "pending"
    const starting = supervisor.start(command, new AbortController().signal).then(
      () => {
        outcome = "started"
      },
      () => {
        outcome = "rejected"
      },
    )

    // When
    await supervisor.dispose()
    await Promise.resolve()

    // Then
    expect(outcome).toBe("rejected")
    expect(child.killSignals).toEqual(["SIGTERM"])
    await starting
  })
})
