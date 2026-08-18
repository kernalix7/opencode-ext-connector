import {
  OperationCancelledError,
  ProcessSupervisorError,
  ResourceDisposedError,
} from "../../src/core/errors"
import { type AsyncDisposableHandle, createAsyncDisposable } from "../../src/core/lifecycle"
import type {
  ProcessCommand,
  ProcessExit,
  ProcessSupervisor,
  SupervisedProcess,
} from "../../src/core/process"

export class FakeSupervisedProcess implements SupervisedProcess {
  public terminationCount = 0
  private readonly exit = Promise.withResolvers<ProcessExit>()
  private readonly disposal: AsyncDisposableHandle
  private completed = false

  public constructor() {
    this.disposal = createAsyncDisposable(() => this.terminate())
  }

  public complete(exit: ProcessExit): void {
    if (!this.completed) {
      this.completed = true
      this.exit.resolve(exit)
    }
  }
  public wait(signal: AbortSignal): Promise<ProcessExit> {
    if (signal.aborted) {
      return Promise.reject(new OperationCancelledError("wait-process"))
    }
    const deferred = Promise.withResolvers<ProcessExit>()
    const onAbort = (): void => deferred.reject(new OperationCancelledError("wait-process"))
    signal.addEventListener("abort", onAbort, { once: true })
    this.exit.promise.then((exit) => {
      signal.removeEventListener("abort", onAbort)
      deferred.resolve(exit)
    }, deferred.reject)
    return deferred.promise
  }
  public async terminate(): Promise<void> {
    if (this.completed) {
      return
    }
    this.terminationCount += 1
    this.complete({ kind: "signal", signal: "SIGTERM" })
  }
  public dispose(): Promise<void> {
    return this.disposal.dispose()
  }
  public [Symbol.asyncDispose](): Promise<void> {
    return this.disposal.dispose()
  }
}

type ProcessScript =
  | { readonly kind: "process"; readonly process: FakeSupervisedProcess }
  | { readonly kind: "error"; readonly error: Error }

export class FakeProcessSupervisor implements ProcessSupervisor {
  public readonly commands: ProcessCommand[] = []
  private readonly scripts: ProcessScript[] = []
  private readonly active = new Set<FakeSupervisedProcess>()
  private readonly disposal: AsyncDisposableHandle
  private disposalStarted = false

  public constructor() {
    this.disposal = createAsyncDisposable(async () => {
      await Promise.all([...this.active].map((process) => process.terminate()))
    })
  }

  public enqueueProcess(process: FakeSupervisedProcess): void {
    this.scripts.push({ kind: "process", process })
  }
  public enqueueError(error: Error): void {
    this.scripts.push({ kind: "error", error })
  }
  public async start(command: ProcessCommand, signal: AbortSignal): Promise<SupervisedProcess> {
    if (signal.aborted) {
      throw new OperationCancelledError("start-process")
    }
    if (this.disposalStarted) {
      throw new ResourceDisposedError("process-supervisor")
    }
    const script = this.scripts.shift()
    if (script === undefined) {
      throw new ProcessSupervisorError({
        operation: "unexpected-start",
        retryable: false,
        cause: null,
      })
    }
    this.commands.push({
      executable: command.executable,
      arguments: [...command.arguments],
      cwd: command.cwd,
    })
    switch (script.kind) {
      case "process":
        this.active.add(script.process)
        return script.process
      case "error":
        throw script.error
    }
  }
  public dispose(): Promise<void> {
    this.disposalStarted = true
    return this.disposal.dispose()
  }
  public [Symbol.asyncDispose](): Promise<void> {
    this.disposalStarted = true
    return this.disposal.dispose()
  }
}
