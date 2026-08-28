import { OperationCancelledError } from "../../src/core/errors"
import { createAsyncDisposable } from "../../src/core/lifecycle"
import {
  type CursorBridgeProcess,
  CursorBridgeProcessError,
  type CursorBridgeProcessExit,
  type CursorBridgeProcessFactory,
} from "../../src/providers/cursor/bridge-process"
import {
  type BridgeCommand,
  type BridgeEvent,
  createBridgeCommandLineDecoder,
  serializeBridgeEvent,
} from "../../src/providers/cursor/bridge-protocol"

type RecordedCommand =
  | Omit<Extract<BridgeCommand, { readonly kind: "open" }>, "accessToken">
  | Exclude<BridgeCommand, { readonly kind: "open" }>

type BlockedWrite = {
  readonly reject: (error: Error) => void
  readonly resolve: () => void
}

/** Provider-local stdio fake. Its observable command log never retains credentials. */
export class FakeCursorBridgeProcess implements CursorBridgeProcess {
  public readonly pid = 4242
  public readonly commands: RecordedCommand[] = []
  public readonly writeSignals: AbortSignal[] = []
  public terminationCount = 0
  private readonly chunks: string[] = []
  private readonly readers: Array<(result: IteratorResult<string>) => void> = []
  private readonly exit = Promise.withResolvers<CursorBridgeProcessExit>()
  private readonly writes: BlockedWrite[] = []
  private readonly writeBlocked = Promise.withResolvers<void>()
  private readonly decoder = createBridgeCommandLineDecoder()
  private readonly disposal = createAsyncDisposable(() => this.terminate())
  private blocked = false
  private completed = false

  public readonly stdout: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => ({ next: () => this.readChunk() }),
  }

  public blockWrites(): void {
    this.blocked = true
  }
  public releaseWrites(): void {
    this.blocked = false
    for (const write of this.writes.splice(0)) write.resolve()
  }
  public waitForBlockedWrite(): Promise<void> {
    return this.writeBlocked.promise
  }
  public emit(event: BridgeEvent): void {
    this.pushChunk(serializeBridgeEvent(event, { accessToken: "" }))
  }
  public emitRaw(chunk: string): void {
    this.pushChunk(chunk)
  }
  public crash(stderr = "bridge crashed"): void {
    this.complete({ code: 1, signal: null, stderr })
  }
  public wait(): Promise<CursorBridgeProcessExit> {
    return this.exit.promise
  }
  public async write(data: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new OperationCancelledError("write-cursor-bridge")
    this.writeSignals.push(signal)
    for (const command of this.decoder.push(data)) {
      this.commands.push(
        command.kind === "open"
          ? { kind: command.kind, id: command.id, path: command.path, headers: command.headers }
          : command,
      )
    }
    if (this.blocked) {
      const deferred = Promise.withResolvers<void>()
      const onAbort = (): void => {
        this.blocked = false
        const index = this.writes.indexOf(blockedWrite)
        if (index >= 0) this.writes.splice(index, 1)
        deferred.reject(new OperationCancelledError("write-cursor-bridge"))
      }
      const blockedWrite: BlockedWrite = {
        reject: deferred.reject,
        resolve: deferred.resolve,
      }
      this.writes.push(blockedWrite)
      this.writeBlocked.resolve()
      signal.addEventListener("abort", onAbort, { once: true })
      try {
        await deferred.promise
      } finally {
        signal.removeEventListener("abort", onAbort)
      }
    }
  }
  public async terminate(): Promise<void> {
    if (this.completed) return
    this.terminationCount += 1
    this.complete({ code: null, signal: "SIGTERM", stderr: "" })
  }
  public dispose(): Promise<void> {
    return this.disposal.dispose()
  }
  public [Symbol.asyncDispose](): Promise<void> {
    return this.disposal.dispose()
  }

  private readChunk(): Promise<IteratorResult<string>> {
    const chunk = this.chunks.shift()
    if (chunk !== undefined) return Promise.resolve({ done: false, value: chunk })
    if (this.completed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => this.readers.push(resolve))
  }
  private pushChunk(chunk: string): void {
    const reader = this.readers.shift()
    if (reader === undefined) this.chunks.push(chunk)
    else reader({ done: false, value: chunk })
  }
  private complete(exit: CursorBridgeProcessExit): void {
    if (this.completed) return
    this.completed = true
    this.exit.resolve(exit)
    for (const reader of this.readers.splice(0)) reader({ done: true, value: undefined })
    for (const write of this.writes.splice(0)) {
      write.reject(new CursorBridgeProcessError("stdin-closed", exit.stderr))
    }
  }
}

export class FakeCursorBridgeProcessFactory implements CursorBridgeProcessFactory {
  public startCount = 0
  public constructor(public readonly process: FakeCursorBridgeProcess) {}
  public async start(signal: AbortSignal): Promise<CursorBridgeProcess> {
    if (signal.aborted) throw new OperationCancelledError("start-cursor-bridge")
    this.startCount += 1
    return this.process
  }
}
