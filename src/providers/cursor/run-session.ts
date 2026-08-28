import type { Clock } from "../../core/clock"
import { InvalidArgumentError } from "../../core/errors"
import { createAsyncDisposable } from "../../core/lifecycle"
import type { CursorBridgeStream } from "./bridge-client"
import type { CursorRequestBlobOwnership } from "./request-blob-ownership"
import {
  type CursorRunSessionBackgroundCleanupErrorHandler,
  settleCursorRunSessionExpiry,
} from "./run-session-expiry"
import type { CursorServerDispatcher } from "./server-dispatch"
import type { CursorSessionId } from "./session-state"
import { settleCursorCleanup } from "./settle-cleanup"

export type CursorRunSessionIdentity = {
  readonly sessionId: CursorSessionId
  readonly modelId: string
}

export type CursorRunSessionResources = CursorRunSessionIdentity & {
  readonly stream: CursorBridgeStream
  readonly ownership: CursorRequestBlobOwnership
  readonly dispatcher: CursorServerDispatcher
  readonly disposeStores: () => void
}

export type CursorRunSessionErrorReason =
  | "duplicate-session"
  | "missing-session"
  | "mismatched-result"
  | "duplicate-result"
  | "ambiguous-result"
  | "retry-boundary"

export class CursorRunSessionError extends Error {
  public override readonly name = "CursorRunSessionError"
  public readonly code = "CURSOR_RUN_SESSION_ERROR"
  public constructor(public readonly reason: CursorRunSessionErrorReason) {
    super("Cursor run session continuation failed")
  }
}

export type CursorRunSession = {
  readonly identity: CursorRunSessionIdentity
  readonly dispatcher: CursorServerDispatcher
  readonly stream: CursorBridgeStream
  readonly write: (frame: Uint8Array, signal?: AbortSignal) => Promise<void>
  readonly writeContinuations: (
    continuations: readonly { readonly callId: string; readonly frame: Uint8Array }[],
    signal?: AbortSignal,
  ) => Promise<void>
  readonly touch: () => void
  readonly abort: () => Promise<void>
  readonly retireForRetry?: () => Promise<void>
  readonly dispose: () => Promise<void>
}

export type CursorRunSessionRegistry = {
  readonly register: (resources: CursorRunSessionResources) => CursorRunSession
  readonly find: (identity: CursorRunSessionIdentity) => CursorRunSession | null
  readonly resolveParkedCalls: (callIds: readonly string[], modelId: string) => CursorRunSession
  readonly terminate: (identity: CursorRunSessionIdentity) => Promise<void>
  readonly size: () => number
  readonly dispose: () => Promise<void>
}

export function createCursorRunSessionRegistry(_options: {
  readonly clock: Clock
  readonly ttlMs: number
  readonly onBackgroundCleanupError: CursorRunSessionBackgroundCleanupErrorHandler
}): CursorRunSessionRegistry {
  const options = _options
  if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 0) {
    throw new InvalidArgumentError("ttlMs")
  }
  const sessions = new Map<CursorSessionId, CursorRunSession>()
  const ownersByModel = new Map<string, Map<string, Set<CursorSessionId>>>()
  let disposed = false

  const removeOwnership = (sessionId: CursorSessionId): void => {
    for (const [modelId, ownersByCallId] of ownersByModel) {
      for (const [callId, owners] of ownersByCallId) {
        owners.delete(sessionId)
        if (owners.size === 0) ownersByCallId.delete(callId)
      }
      if (ownersByCallId.size === 0) ownersByModel.delete(modelId)
    }
  }

  const terminate = async (identity: CursorRunSessionIdentity): Promise<void> => {
    const session = sessions.get(identity.sessionId)
    if (session === undefined) return
    sessions.delete(identity.sessionId)
    removeOwnership(identity.sessionId)
    await session.dispose()
  }

  const register = (resources: CursorRunSessionResources): CursorRunSession => {
    if (disposed) throw new CursorRunSessionError("missing-session")
    const identity = {
      sessionId: resources.sessionId,
      modelId: resources.modelId,
    }
    if (sessions.has(identity.sessionId)) throw new CursorRunSessionError("duplicate-session")
    const consumed = new Set<string>()
    const reserved = new Set<string>()
    let writes = Promise.resolve()
    let timer: ReturnType<Clock["schedule"]> | undefined
    let streamSettlement: "abort" | "close" = "close"
    let retired = false
    const cancelTimer = (): void => {
      timer?.cancel()
      timer = undefined
    }
    const disposal = createAsyncDisposable(() => {
      cancelTimer()
      removeOwnership(identity.sessionId)
      resources.dispatcher.parkedCalls.clear()
      if (retired) return
      return settleCursorCleanup([
        streamSettlement === "abort" ? resources.stream.abort : resources.stream.close,
        resources.ownership.release,
        resources.disposeStores,
      ])
    })
    const touch = (): void => {
      cancelTimer()
      removeOwnership(identity.sessionId)
      const ownersByCallId = ownersByModel.get(identity.modelId) ?? new Map()
      for (const callId of resources.dispatcher.parkedCalls.keys()) {
        const owners = ownersByCallId.get(callId) ?? new Set<CursorSessionId>()
        owners.add(identity.sessionId)
        ownersByCallId.set(callId, owners)
      }
      ownersByModel.set(identity.modelId, ownersByCallId)
      timer = options.clock.schedule(options.ttlMs, () => {
        settleCursorRunSessionExpiry({
          identity,
          terminate,
          onBackgroundCleanupError: options.onBackgroundCleanupError,
        })
      })
    }
    const session: CursorRunSession = {
      identity,
      dispatcher: resources.dispatcher,
      stream: resources.stream,
      write: (frame, signal): Promise<void> => {
        const operation = writes.then(() => resources.stream.write(frame, signal))
        writes = operation.then(
          () => undefined,
          () => undefined,
        )
        return operation
      },
      writeContinuations: (continuations, signal): Promise<void> => {
        const transactionIds = new Set<string>()
        for (const continuation of continuations) {
          if (consumed.has(continuation.callId) || reserved.has(continuation.callId)) {
            return Promise.reject(new CursorRunSessionError("duplicate-result"))
          }
          if (!resources.dispatcher.parkedCalls.has(continuation.callId)) {
            return Promise.reject(new CursorRunSessionError("mismatched-result"))
          }
          if (transactionIds.has(continuation.callId)) {
            return Promise.reject(new CursorRunSessionError("duplicate-result"))
          }
          transactionIds.add(continuation.callId)
        }
        for (const callId of transactionIds) reserved.add(callId)
        cancelTimer()
        removeOwnership(identity.sessionId)
        const operation = writes.then(async () => {
          for (const continuation of continuations) {
            await resources.stream.write(continuation.frame, signal)
          }
        })
        const transaction = operation.then(
          () => {
            for (const callId of transactionIds) {
              resources.dispatcher.parkedCalls.delete(callId)
              reserved.delete(callId)
              consumed.add(callId)
            }
          },
          async (error: unknown) => {
            for (const callId of transactionIds) reserved.delete(callId)
            try {
              await terminate(identity)
            } catch (cleanupError) {
              const message = error instanceof Error ? error.message : "Continuation write failed"
              throw new AggregateError([error, cleanupError], message)
            }
            throw error
          },
        )
        writes = transaction.then(
          () => undefined,
          () => undefined,
        )
        return transaction
      },
      touch,
      abort: (): Promise<void> => {
        streamSettlement = "abort"
        sessions.delete(identity.sessionId)
        removeOwnership(identity.sessionId)
        return disposal.dispose()
      },
      retireForRetry: async (): Promise<void> => {
        if (resources.dispatcher.parkedCalls.size > 0 || reserved.size > 0)
          throw new CursorRunSessionError("retry-boundary")
        retired = true
        cancelTimer()
        sessions.delete(identity.sessionId)
        removeOwnership(identity.sessionId)
        resources.dispatcher.parkedCalls.clear()
        await settleCursorCleanup([resources.stream.abort, resources.ownership.release])
      },
      dispose: disposal.dispose,
    }
    sessions.set(identity.sessionId, session)
    return session
  }

  const resolveParkedCalls = (callIds: readonly string[], modelId: string): CursorRunSession => {
    let resolved: CursorRunSession | null = null
    const ownersByCallId = ownersByModel.get(modelId)
    for (const callId of callIds) {
      const owners = ownersByCallId?.get(callId)
      if (owners === undefined) throw new CursorRunSessionError("missing-session")
      if (owners.size !== 1) throw new CursorRunSessionError("ambiguous-result")
      const sessionId = owners.values().next().value
      const candidate = sessionId === undefined ? undefined : sessions.get(sessionId)
      if (candidate === undefined) throw new CursorRunSessionError("missing-session")
      if (candidate.identity.modelId !== modelId) {
        throw new CursorRunSessionError("mismatched-result")
      }
      if (resolved !== null && resolved !== candidate) {
        throw new CursorRunSessionError("mismatched-result")
      }
      resolved = candidate
    }
    if (resolved === null) throw new CursorRunSessionError("missing-session")
    return resolved
  }

  const disposal = createAsyncDisposable(async () => {
    disposed = true
    const active = [...sessions.values()]
    sessions.clear()
    ownersByModel.clear()
    await settleCursorCleanup(active.map((session) => session.dispose))
  })

  return {
    register,
    find: (identity): CursorRunSession | null => sessions.get(identity.sessionId) ?? null,
    resolveParkedCalls,
    terminate,
    size: (): number => sessions.size,
    dispose: disposal.dispose,
  }
}
