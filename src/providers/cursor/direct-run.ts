import { OperationCancelledError } from "../../core/errors.js"
import { parseModelId } from "../../core/ids.js"
import { createCursorBlobStore } from "./blob-store.js"
import type { CursorBridgeStream } from "./bridge-client.js"
import type { CursorCheckpointStore } from "./checkpoint-store.js"
import { createCursorCheckpointStore } from "./checkpoint-store.js"
import { encodeConnectFrame } from "./connect-frame.js"
import type { CursorDirectRunOptions, CursorDirectSetupCleanup } from "./direct-run-types.js"
import { consumeCursorDirectAttempt, isCursorRetryableStreamError } from "./direct-stream.js"
import { cursorMcpDefinitions } from "./exec-reply.js"
import { cursorPromptText } from "./prompt.js"
import { createCursorIdleWatchdog, createCursorRecoveryPlanner } from "./recovery.js"
import { buildCursorAgentRunRequest } from "./request-build.js"
import type { CursorRunSession } from "./run-session.js"
import { createCursorServerDispatcher } from "./server-dispatch.js"
import type { CursorSessionId } from "./session-state.js"
import { createCursorSessionStateStore, parseCursorSessionId } from "./session-state.js"
import { settleCursorCleanup } from "./settle-cleanup.js"
import { type CursorStreamAdapter, createCursorStreamAdapter } from "./stream-adapter.js"

const CURSOR_RUN_PATH = "/agent.v1.AgentService/Run"

type LogicalRun = {
  readonly adapter: CursorStreamAdapter
  readonly blobStore: ReturnType<typeof createCursorBlobStore>
  readonly checkpointStore: CursorCheckpointStore
  readonly cleanup: CursorDirectSetupCleanup
  readonly sessionId: CursorSessionId
}

function createLogicalRun(options: CursorDirectRunOptions): LogicalRun {
  const sessionId = parseCursorSessionId(options.createId())
  const blobStore = createCursorBlobStore({
    clock: options.clock,
    maxBytes: 16_777_216,
    maxEntries: 1_024,
    ttlMs: options.ttlMs,
  })
  const checkpointStore = createCursorCheckpointStore({
    blobStore,
    clock: options.clock,
    maxBytes: 8_388_608,
    maxEntries: 4,
    ttlMs: options.ttlMs,
  })
  const sessionStore = createCursorSessionStateStore({
    blobStore,
    clock: options.clock,
    maxKeysPerSession: 128,
    maxSessions: 4,
    ttlMs: options.ttlMs,
  })
  const placeholder = buildRequest(options, { blobStore, checkpointStore, sessionId }, "initial")
  const cleanup = options.createSetupCleanup?.({
    checkpointStore,
    ownership: placeholder.ownership,
    sessionId,
    sessionStore,
  }) ?? {
    releaseOwnership: placeholder.ownership.release,
    invalidateCheckpoint: () => checkpointStore.invalidate(sessionId),
    invalidateSession: () => sessionStore.invalidate(sessionId),
  }
  placeholder.ownership.release()
  return { adapter: createCursorStreamAdapter(), blobStore, checkpointStore, cleanup, sessionId }
}

function buildRequest(
  options: CursorDirectRunOptions,
  logical: Pick<LogicalRun, "blobStore" | "checkpointStore" | "sessionId">,
  mode: "initial" | "checkpoint" | "history",
) {
  const common = {
    conversationId: logical.sessionId,
    history: [],
    rootSystemPrompt: "",
    mcpTools: cursorMcpDefinitions(options.tools),
    modelId: parseModelId(options.modelId),
    modelParameters: [],
  }
  return buildCursorAgentRunRequest({
    blobStore: logical.blobStore,
    checkpointStore: logical.checkpointStore,
    createId: options.createId,
    input:
      mode === "checkpoint"
        ? {
            ...common,
            mode: "checkpoint",
            sessionId: logical.sessionId,
            action: { kind: "resume" },
          }
        : {
            ...common,
            mode: "fresh",
            action: { kind: "user", text: cursorPromptText(options.call), images: [] },
          },
  })
}

async function openAttempt(
  options: CursorDirectRunOptions,
  logical: LogicalRun,
  mode: "initial" | "checkpoint" | "history",
): Promise<CursorRunSession> {
  const request = buildRequest(options, logical, mode)
  let stream: CursorBridgeStream | null = null
  try {
    stream = await options.bridge.open({
      id: options.createId(),
      accessToken: options.token,
      path: CURSOR_RUN_PATH,
      headers: { "content-type": "application/connect+proto", "connect-protocol-version": "1" },
      signal: options.signal,
    })
    if (options.signal.aborted) throw new OperationCancelledError("cursor-direct-stream")
    await stream.write(encodeConnectFrame(request.bytes), options.signal)
    if (options.signal.aborted) throw new OperationCancelledError("cursor-direct-stream")
    return options.registry.register({
      sessionId: logical.sessionId,
      modelId: options.modelId,
      stream,
      ownership: request.ownership,
      dispatcher: createCursorServerDispatcher({
        blobStore: logical.blobStore,
        checkpointStore: logical.checkpointStore,
        sessionId: logical.sessionId,
        tools: options.tools,
      }),
      disposeStores: () => {
        logical.cleanup.invalidateCheckpoint()
        logical.cleanup.invalidateSession()
      },
    })
  } catch (error) {
    try {
      await settleCursorCleanup([
        ...(stream === null ? [] : [stream.abort]),
        request.ownership.release,
      ])
    } catch (cleanupError) {
      const message = error instanceof Error ? error.message : "Cursor setup failed"
      throw new AggregateError([error, cleanupError], message)
    }
    throw error
  }
}

async function failRun(
  logical: LogicalRun,
  session: CursorRunSession | null,
  error: unknown,
): Promise<void> {
  try {
    if (session === null) {
      logical.cleanup.invalidateCheckpoint()
      logical.cleanup.invalidateSession()
    } else await session.abort()
  } catch (cleanupError) {
    logical.adapter.fail(
      new AggregateError([error, cleanupError], "Cursor recovery cleanup failed"),
    )
    return
  }
  logical.adapter.fail(error)
}

export async function startCursorDirectRun(
  options: CursorDirectRunOptions,
): Promise<{ readonly stream: CursorStreamAdapter["stream"] }> {
  const logical = createLogicalRun(options)
  const planner = createCursorRecoveryPlanner()
  let session: CursorRunSession | null
  try {
    session = await openAttempt(options, logical, "initial")
  } catch (error) {
    logical.cleanup.releaseOwnership()
    logical.cleanup.invalidateCheckpoint()
    logical.cleanup.invalidateSession()
    throw error
  }
  void (async () => {
    for (;;) {
      const watchdog = createCursorIdleWatchdog({
        clock: options.clock,
        idleTimeoutMs: options.idleTimeoutMs,
        parentSignal: options.signal,
      })
      try {
        const exit = await consumeCursorDirectAttempt({
          session,
          signal: watchdog.signal,
          watchdog,
          adapter: logical.adapter,
        })
        watchdog.dispose()
        if (exit.kind === "terminal") await options.registry.terminate(session.identity)
        else session.touch()
        logical.adapter.finish(exit.kind === "parked" ? "tool-calls" : "stop")
        return
      } catch (error) {
        const idle = watchdog.expired()
        watchdog.dispose()
        if (options.signal.aborted) {
          await failRun(logical, session, new OperationCancelledError("cursor-direct-stream"))
          return
        }
        const decision = planner.next({
          checkpointAvailable: logical.checkpointStore.resume(logical.sessionId) !== null,
          replay: logical.adapter.replayState(),
          retryable: idle || isCursorRetryableStreamError(error),
        })
        if (decision.kind === "fail") {
          try {
            planner.requireRetry(decision, error)
          } catch (recoveryError) {
            await failRun(logical, session, recoveryError)
          }
          return
        }
        try {
          const retireForRetry = session.retireForRetry
          if (retireForRetry === undefined) throw new TypeError("retry retirement is unavailable")
          await retireForRetry()
          logical.adapter.suspendForRetry()
          session = await openAttempt(options, logical, decision.mode)
        } catch (retryError) {
          await failRun(logical, session, retryError)
          return
        }
      }
    }
  })()
  return { stream: logical.adapter.stream }
}
