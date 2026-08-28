import { OperationCancelledError, ResourceDisposedError } from "../../core/errors"
import { createAsyncDisposable } from "../../core/lifecycle"
import {
  type CursorBridgeProcess,
  CursorBridgeProcessError,
  type CursorBridgeProcessFactory,
  createNodeCursorBridgeProcessFactory,
} from "./bridge-process"
import {
  type BridgeCommand,
  type BridgeEvent,
  CursorBridgeProtocolError,
  createBridgeEventLineDecoder,
  serializeBridgeCommand,
} from "./bridge-protocol"

export type CursorBridgeSessionErrorReason = "duplicate-stream" | "stream-closed"

export class CursorBridgeSessionError extends Error {
  public override readonly name = "CursorBridgeSessionError"
  public readonly code = "CURSOR_BRIDGE_SESSION_ERROR"
  public constructor(public readonly reason: CursorBridgeSessionErrorReason) {
    super("Cursor bridge stream is unavailable")
  }
}

type EventWaiter = {
  readonly resolve: (event: BridgeEvent) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal | undefined
  readonly onAbort: (() => void) | undefined
}

class EventInbox {
  private readonly events: BridgeEvent[] = []
  private readonly waiters: EventWaiter[] = []
  private failure: Error | null = null
  private finished = false

  public push(event: BridgeEvent): void {
    if (this.failure !== null || this.finished) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.events.push(event)
    else {
      if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
        waiter.signal.removeEventListener("abort", waiter.onAbort)
      }
      waiter.resolve(event)
    }
  }
  public next(signal?: AbortSignal): Promise<BridgeEvent> {
    const event = this.events.shift()
    if (event !== undefined) return Promise.resolve(event)
    if (this.failure !== null) return Promise.reject(this.failure)
    if (this.finished) return Promise.reject(new CursorBridgeSessionError("stream-closed"))
    if (signal?.aborted === true) {
      return Promise.reject(new OperationCancelledError("wait-cursor-bridge-event"))
    }
    const deferred = Promise.withResolvers<BridgeEvent>()
    const onAbort =
      signal === undefined
        ? undefined
        : (): void => {
            const index = this.waiters.findIndex(
              (candidate) => candidate.resolve === deferred.resolve,
            )
            if (index >= 0) this.waiters.splice(index, 1)
            deferred.reject(new OperationCancelledError("wait-cursor-bridge-event"))
          }
    if (onAbort !== undefined) signal?.addEventListener("abort", onAbort, { once: true })
    this.waiters.push({ resolve: deferred.resolve, reject: deferred.reject, signal, onAbort })
    return deferred.promise
  }
  public finish(): void {
    this.finished = true
    this.rejectWaiters(new CursorBridgeSessionError("stream-closed"))
  }
  public fail(error: Error): void {
    if (this.failure !== null || this.finished) return
    this.failure = error
    this.rejectWaiters(error)
  }
  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
        waiter.signal.removeEventListener("abort", waiter.onAbort)
      }
      waiter.reject(error)
    }
  }
}

type Session = {
  readonly inbox: EventInbox
  readonly abortSignal: AbortSignal
  readonly abortListener: () => void
}

export type CursorBridgeOpenInput = {
  readonly id: string
  readonly accessToken: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly signal: AbortSignal
}

export interface CursorBridgeStream {
  readonly id: string
  write(payload: Uint8Array, signal?: AbortSignal): Promise<void>
  nextEvent(signal?: AbortSignal): Promise<BridgeEvent>
  abort(): Promise<void>
  close(): Promise<void>
}

export interface CursorBridgeClient extends AsyncDisposable {
  readonly pid: number
  open(input: CursorBridgeOpenInput): Promise<CursorBridgeStream>
  dispose(): Promise<void>
}

export type CursorBridgeClientOptions = {
  readonly processFactory?: CursorBridgeProcessFactory
  readonly signal?: AbortSignal
}

function processFailure(
  exit: Awaited<ReturnType<CursorBridgeProcess["wait"]>>,
): CursorBridgeProcessError {
  const status = exit.code === null ? (exit.signal ?? "unknown signal") : `code ${exit.code}`
  const detail = exit.stderr.length === 0 ? status : `${status}: ${exit.stderr}`
  return new CursorBridgeProcessError("child-exited", detail)
}

export async function createCursorBridgeClient(
  options: CursorBridgeClientOptions = {},
): Promise<CursorBridgeClient> {
  const lifecycle = new AbortController()
  if (options.signal?.aborted === true) throw new OperationCancelledError("start-cursor-bridge")
  const processFactory = options.processFactory ?? createNodeCursorBridgeProcessFactory()
  const child = await processFactory.start(options.signal ?? lifecycle.signal)
  const sessions = new Map<string, Session>()
  const claimedIds = new Set<string>()
  const decoder = createBridgeEventLineDecoder()
  let fatal: Error | null = null
  let disposed = false
  let writes = Promise.resolve()

  const failAll = (error: Error): void => {
    if (fatal === null) fatal = error
    for (const session of sessions.values()) session.inbox.fail(error)
    sessions.clear()
  }
  const send = (command: BridgeCommand, signal: AbortSignal = lifecycle.signal): Promise<void> => {
    const operation = writes.then(async () => {
      if (disposed) throw new ResourceDisposedError("cursor-bridge-client")
      if (fatal !== null) throw fatal
      await child.write(serializeBridgeCommand(command), signal)
    })
    writes = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
  const finishSession = (id: string, event: BridgeEvent): void => {
    const session = sessions.get(id)
    if (session === undefined) return
    session.inbox.push(event)
    if (event.kind === "end" || event.kind === "error") {
      session.abortSignal.removeEventListener("abort", session.abortListener)
      session.inbox.finish()
      sessions.delete(id)
    }
  }

  const outputTask = (async (): Promise<void> => {
    try {
      for await (const chunk of child.stdout) {
        for (const event of decoder.push(chunk)) finishSession(event.id, event)
      }
      decoder.finish()
    } catch (error) {
      const failure =
        error instanceof CursorBridgeProtocolError || error instanceof CursorBridgeProcessError
          ? error
          : new CursorBridgeProcessError("stdout-failed", "stdout reader failed")
      failAll(failure)
      await child.terminate()
    }
  })()
  const exitTask = child.wait().then((exit) => {
    if (!disposed && fatal === null) failAll(processFailure(exit))
  })

  const disposal = createAsyncDisposable(async () => {
    disposed = true
    lifecycle.abort()
    const error = new ResourceDisposedError("cursor-bridge-client")
    for (const session of sessions.values()) {
      session.abortSignal.removeEventListener("abort", session.abortListener)
      session.inbox.fail(error)
    }
    sessions.clear()
    await child.dispose()
    await Promise.all([outputTask, exitTask])
  })

  return {
    pid: child.pid,
    async open(input: CursorBridgeOpenInput): Promise<CursorBridgeStream> {
      if (disposed) throw new ResourceDisposedError("cursor-bridge-client")
      if (fatal !== null) throw fatal
      if (claimedIds.has(input.id)) throw new CursorBridgeSessionError("duplicate-stream")
      if (input.signal.aborted) throw new OperationCancelledError("open-cursor-bridge-stream")
      claimedIds.add(input.id)
      const inbox = new EventInbox()
      let abortOperation: Promise<void> | null = null
      const abort = (): Promise<void> => {
        if (abortOperation !== null) return abortOperation
        sessions.delete(input.id)
        input.signal.removeEventListener("abort", abortListener)
        inbox.fail(new OperationCancelledError("cursor-bridge-stream"))
        abortOperation = send({ kind: "abort", id: input.id })
        return abortOperation
      }
      const abortListener = (): void => {
        void abort()
      }
      sessions.set(input.id, { inbox, abortSignal: input.signal, abortListener })
      input.signal.addEventListener("abort", abortListener, { once: true })
      await send({
        kind: "open",
        id: input.id,
        accessToken: input.accessToken,
        path: input.path,
        headers: input.headers,
      })
      return {
        id: input.id,
        write: (payload, signal): Promise<void> =>
          send({ kind: "write-frame", id: input.id, payload }, signal),
        nextEvent: (signal): Promise<BridgeEvent> => inbox.next(signal),
        abort,
        close: (): Promise<void> => send({ kind: "close", id: input.id }),
      }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal.dispose,
  }
}
