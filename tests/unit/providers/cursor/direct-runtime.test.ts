import { describe, expect, it } from "bun:test"

import { OperationCancelledError } from "../../../../src/core/errors"
import type {
  CursorBridgeClient,
  CursorBridgeStream,
} from "../../../../src/providers/cursor/bridge-client"
import type { CursorCheckpointStore } from "../../../../src/providers/cursor/checkpoint-store"
import { createCursorDirectRuntime } from "../../../../src/providers/cursor/direct-runtime"
import type { CursorRequestBlobOwnership } from "../../../../src/providers/cursor/request-blob-ownership"
import type {
  CursorSessionId,
  CursorSessionStateStore,
} from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

type BridgeState = {
  readonly writes: Uint8Array[]
  openCount: number
  abortCount: number
  closeCount: number
  disposeCount: number
  readonly writeSignals: Array<AbortSignal | undefined>
}

type SetupCleanupResources = {
  readonly checkpointStore: CursorCheckpointStore
  readonly ownership: CursorRequestBlobOwnership
  readonly sessionId: CursorSessionId
  readonly sessionStore: CursorSessionStateStore
}

function ids(): () => string {
  let next = 0
  return (): string => `id-${++next}`
}

function bridgeFixture(
  options: {
    readonly open?: (stream: CursorBridgeStream) => Promise<CursorBridgeStream>
    readonly abortFails?: boolean
    readonly closeFails?: boolean
    readonly writeFails?: boolean
    readonly write?: (signal: AbortSignal | undefined) => Promise<void>
  } = {},
): {
  readonly client: CursorBridgeClient
  readonly state: BridgeState
  readonly stream: CursorBridgeStream
} {
  const state: BridgeState = {
    writes: [],
    openCount: 0,
    abortCount: 0,
    closeCount: 0,
    disposeCount: 0,
    writeSignals: [],
  }
  const pendingEvent = Promise.withResolvers<never>()
  const stream: CursorBridgeStream = {
    id: "stream-1",
    write: async (frame, signal) => {
      state.writes.push(new Uint8Array(frame))
      state.writeSignals.push(signal)
      await options.write?.(signal)
      if (options.writeFails === true) throw new Error("write failed")
    },
    nextEvent: () => pendingEvent.promise,
    abort: async () => {
      state.abortCount += 1
      if (options.abortFails === true) throw new Error("abort failed")
    },
    close: async () => {
      state.closeCount += 1
      if (options.closeFails === true) throw new Error("close failed")
    },
  }
  const dispose = async (): Promise<void> => {
    state.disposeCount += 1
  }
  const client: CursorBridgeClient = {
    pid: 1,
    open: async () => {
      state.openCount += 1
      return options.open?.(stream) ?? stream
    },
    dispose,
    [Symbol.asyncDispose]: dispose,
  }
  return { client, state, stream }
}

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }]
const ignoreBackgroundCleanupError = (): void => undefined

describe("createCursorDirectRuntime setup lifecycle", () => {
  it("does not open or write a Run when the call aborts during token read", async () => {
    // Given
    const token = Promise.withResolvers<string | null>()
    const fixture = bridgeFixture()
    const abort = new AbortController()
    const runtime = createCursorDirectRuntime({
      clock: new FakeClock(),
      createId: ids(),
      readAccessToken: () => token.promise,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
      createBridgeClient: async () => fixture.client,
    })
    const result = runtime.doStream({ prompt, abortSignal: abort.signal }, "auto")

    // When
    abort.abort()
    token.resolve("token")

    // Then
    await expect(result).rejects.toBeInstanceOf(OperationCancelledError)
    expect(fixture.state.openCount).toBe(0)
    expect(fixture.state.writes).toEqual([])
    await runtime.dispose()
  })

  it("aborts an opened stream without a Run write when the call aborts during open", async () => {
    // Given
    const opened = Promise.withResolvers<CursorBridgeStream>()
    const openStarted = Promise.withResolvers<void>()
    const fixture = bridgeFixture({
      open: () => {
        openStarted.resolve()
        return opened.promise
      },
    })
    const abort = new AbortController()
    const runtime = createCursorDirectRuntime({
      clock: new FakeClock(),
      createId: ids(),
      readAccessToken: async () => "token",
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
      createBridgeClient: async () => fixture.client,
    })
    const result = runtime.doStream({ prompt, abortSignal: abort.signal }, "auto")
    await openStarted.promise

    // When
    abort.abort()
    opened.resolve(fixture.stream)

    // Then
    await expect(result).rejects.toBeInstanceOf(OperationCancelledError)
    expect(fixture.state.writes).toEqual([])
    expect(fixture.state.abortCount).toBe(1)
    await runtime.dispose()
  })

  it("rejects promptly when abort interrupts the blocked initial Run write", async () => {
    // Given
    const writeStarted = Promise.withResolvers<void>()
    const releaseWrite = Promise.withResolvers<void>()
    const fixture = bridgeFixture({
      write: async (signal) => {
        writeStarted.resolve()
        if (signal === undefined) {
          await releaseWrite.promise
          return
        }
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => reject(new OperationCancelledError("blocked-run-write"))
          signal.addEventListener("abort", onAbort, { once: true })
          void releaseWrite.promise.then(resolve).finally(() => {
            signal.removeEventListener("abort", onAbort)
          })
        })
      },
    })
    const abort = new AbortController()
    const runtime = createCursorDirectRuntime({
      clock: new FakeClock(),
      createId: ids(),
      readAccessToken: async () => "token",
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
      createBridgeClient: async () => fixture.client,
    })
    const result = runtime.doStream({ prompt, abortSignal: abort.signal }, "auto")
    await writeStarted.promise

    // When
    abort.abort()

    // Then
    try {
      expect(fixture.state.writeSignals.at(-1)).not.toBeUndefined()
      await expect(result).rejects.toBeInstanceOf(OperationCancelledError)
      expect(fixture.state.abortCount).toBe(1)
    } finally {
      releaseWrite.resolve()
      await result.catch(() => undefined)
      await runtime.dispose()
    }
  })

  it("attempts bridge disposal when session cleanup fails", async () => {
    // Given
    const fixture = bridgeFixture({ closeFails: true })
    const runtime = createCursorDirectRuntime({
      clock: new FakeClock(),
      createId: ids(),
      readAccessToken: async () => "token",
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
      createBridgeClient: async () => fixture.client,
    })
    await runtime.doStream({ prompt }, "auto")

    // When
    const disposal = runtime.dispose()

    // Then
    await expect(disposal).rejects.toThrow()
    expect(fixture.state.closeCount).toBe(1)
    expect(fixture.state.disposeCount).toBe(1)
  })

  it("preserves setup failure when stream abort cleanup also fails", async () => {
    // Given
    const fixture = bridgeFixture({ abortFails: true, writeFails: true })
    const cleanupCounts = { ownership: 0, checkpoint: 0, session: 0 }
    const runtimeOptions = {
      clock: new FakeClock(),
      createId: ids(),
      readAccessToken: async () => "token",
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
      createBridgeClient: async () => fixture.client,
      createSetupCleanup: (resources: SetupCleanupResources) => ({
        releaseOwnership: (): void => {
          cleanupCounts.ownership += 1
          resources.ownership.release()
        },
        invalidateCheckpoint: (): void => {
          cleanupCounts.checkpoint += 1
          resources.checkpointStore.invalidate(resources.sessionId)
        },
        invalidateSession: (): void => {
          cleanupCounts.session += 1
          resources.sessionStore.invalidate(resources.sessionId)
        },
      }),
    }
    const runtime = createCursorDirectRuntime(runtimeOptions)

    // When
    const result = runtime.doStream({ prompt }, "auto")

    // Then
    await expect(result).rejects.toEqual(
      expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ message: "write failed" }),
          expect.objectContaining({ message: "Cursor cleanup failed" }),
        ]),
      }),
    )
    expect(fixture.state.abortCount).toBe(1)
    expect(cleanupCounts).toEqual({ ownership: 1, checkpoint: 1, session: 1 })
    await runtime.dispose()
  })
})
