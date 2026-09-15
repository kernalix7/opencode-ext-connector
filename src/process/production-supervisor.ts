import { spawn } from "node:child_process"

import {
  OperationCancelledError,
  ProcessSupervisorError,
  ResourceDisposedError,
} from "../core/errors.js"
import { type AsyncDisposableHandle, createAsyncDisposable } from "../core/lifecycle.js"
import type {
  ProcessCommand,
  ProcessExit,
  ProcessSupervisor,
  SupervisedProcess,
} from "../core/process.js"

export type ProcessSpawnOptions = {
  readonly shell: false
  readonly stdio: "ignore"
  readonly windowsHide: true
}

export interface SpawnedChild {
  readonly exitCode: number | null
  readonly signalCode: string | null
  onSpawn(listener: () => void): () => void
  onError(listener: (error: Error) => void): () => void
  onExit(listener: (exit: ProcessExit) => void): () => void
  kill(signal: "SIGTERM" | "SIGKILL"): boolean
}

export type ProcessSpawn = (command: ProcessCommand, options: ProcessSpawnOptions) => SpawnedChild

export type ProductionProcessSupervisorOptions = {
  readonly spawn?: ProcessSpawn
  readonly terminationGraceMs?: number
}

const spawnOptions: ProcessSpawnOptions = {
  shell: false,
  stdio: "ignore",
  windowsHide: true,
}

function spawnNodeChild(command: ProcessCommand, options: ProcessSpawnOptions): SpawnedChild {
  const child = spawn(command.executable, [...command.arguments], {
    cwd: command.cwd ?? undefined,
    shell: options.shell,
    stdio: options.stdio,
    windowsHide: options.windowsHide,
  })
  return {
    get exitCode() {
      return child.exitCode
    },
    get signalCode() {
      return child.signalCode
    },
    onSpawn: (listener) => {
      child.once("spawn", listener)
      return () => child.removeListener("spawn", listener)
    },
    onError: (listener) => {
      child.once("error", listener)
      return () => child.removeListener("error", listener)
    },
    onExit: (listener) => {
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        listener(
          code === null ? { kind: "signal", signal: signal ?? "unknown" } : { kind: "code", code },
        )
      }
      child.once("exit", onExit)
      return () => child.removeListener("exit", onExit)
    },
    kill: (signal) => child.kill(signal),
  }
}

function processFailure(operation: string, cause: unknown): ProcessSupervisorError {
  return new ProcessSupervisorError({ operation, retryable: true, cause })
}

class ProductionSupervisedProcess implements SupervisedProcess {
  private readonly completion: Promise<ProcessExit>
  private readonly spawned: Promise<void>
  private readonly disposal: AsyncDisposableHandle

  public constructor(child: SpawnedChild, terminationGraceMs: number) {
    this.spawned = new Promise<void>((resolve, reject) => {
      const removeSpawn = child.onSpawn(() => {
        removeError()
        resolve()
      })
      const removeError = child.onError((error) => {
        removeSpawn()
        reject(processFailure("spawn", error))
      })
    })
    this.completion = new Promise<ProcessExit>((resolve, reject) => {
      const removeExit = child.onExit((exit) => {
        removeError()
        resolve(exit)
      })
      const removeError = child.onError((error) => {
        removeExit()
        reject(processFailure("wait", error))
      })
    })
    this.disposal = createAsyncDisposable(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill("SIGTERM")
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        this.completion,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, terminationGraceMs)
          timer.unref()
        }),
      ])
      if (timer !== undefined) clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) {
        if (!child.kill("SIGKILL")) throw processFailure("terminate", null)
        await this.completion
      }
    })
  }

  public ready(signal: AbortSignal): Promise<void> {
    return this.raceCancellation(this.spawned, signal, "start-process")
  }
  public wait(signal: AbortSignal): Promise<ProcessExit> {
    return this.raceCancellation(this.completion, signal, "wait-process")
  }
  public terminate(): Promise<void> {
    return this.disposal.dispose()
  }
  public dispose(): Promise<void> {
    return this.disposal.dispose()
  }
  public [Symbol.asyncDispose](): Promise<void> {
    return this.disposal.dispose()
  }

  private raceCancellation<T>(
    operation: Promise<T>,
    signal: AbortSignal,
    name: string,
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(new OperationCancelledError(name))
    const deferred = Promise.withResolvers<T>()
    const onAbort = (): void => deferred.reject(new OperationCancelledError(name))
    signal.addEventListener("abort", onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        deferred.resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        deferred.reject(error)
      },
    )
    return deferred.promise
  }
}

export function createProductionProcessSupervisor(
  options: ProductionProcessSupervisorOptions = {},
): ProcessSupervisor {
  const spawnProcess = options.spawn ?? spawnNodeChild
  const terminationGraceMs = options.terminationGraceMs ?? 1_000
  const active = new Set<ProductionSupervisedProcess>()
  const disposalController = new AbortController()
  let disposalStarted = false
  const disposal = createAsyncDisposable(async () => {
    disposalStarted = true
    disposalController.abort()
    await Promise.all([...active].map((process) => process.terminate()))
  })
  const start = async (
    command: ProcessCommand,
    signal: AbortSignal,
  ): Promise<SupervisedProcess> => {
    if (signal.aborted) throw new OperationCancelledError("start-process")
    if (disposalStarted) throw new ResourceDisposedError("process-supervisor")
    let child: SpawnedChild
    try {
      child = spawnProcess(command, spawnOptions)
    } catch (error) {
      throw processFailure("spawn", error)
    }
    const process = new ProductionSupervisedProcess(child, terminationGraceMs)
    active.add(process)
    try {
      await process.ready(AbortSignal.any([signal, disposalController.signal]))
      if (disposalStarted) {
        await process.terminate()
        throw new ResourceDisposedError("process-supervisor")
      }
      return process
    } catch (error) {
      active.delete(process)
      if (error instanceof OperationCancelledError) await process.terminate()
      if (disposalStarted) throw new ResourceDisposedError("process-supervisor")
      throw error
    } finally {
      void process.wait(new AbortController().signal).then(
        () => active.delete(process),
        () => active.delete(process),
      )
    }
  }
  return {
    start,
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
