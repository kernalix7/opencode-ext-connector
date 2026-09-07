import { describe, expect, it } from "bun:test"

import { OperationCancelledError } from "../../../../src/core/errors"
import type {
  CursorBridgeClient,
  CursorBridgeOpenInput,
  CursorBridgeStream,
} from "../../../../src/providers/cursor/bridge-client"
import { encodeConnectFrame } from "../../../../src/providers/cursor/connect-frame"
import { createCursorDirectRuntime } from "../../../../src/providers/cursor/direct-runtime"
import { encodeAgentServerMessage } from "../../../../src/providers/cursor/proto/server"
import { CursorRecoveryError } from "../../../../src/providers/cursor/recovery"
import { FakeClock } from "../../../support/clock"

type Attempt = {
  readonly events: readonly (
    | { readonly kind: "headers"; readonly status: number }
    | { readonly kind: "turn-ended" }
  )[]
  readonly abortFails?: boolean
}

function ids(): () => string {
  let next = 0
  return (): string => `credential-retry-${++next}`
}

function bridgeFixture(attempts: readonly Attempt[]): {
  readonly client: CursorBridgeClient
  readonly tokens: readonly string[]
  readonly aborts: () => number
} {
  const tokens: string[] = []
  let aborts = 0
  let opens = 0
  const open = async (input: CursorBridgeOpenInput): Promise<CursorBridgeStream> => {
    const attempt = attempts[opens]
    if (attempt === undefined) throw new TypeError("unexpected Cursor attempt")
    opens += 1
    tokens.push(input.accessToken)
    let eventIndex = 0
    return {
      id: input.id,
      write: async () => undefined,
      nextEvent: async () => {
        const event = attempt.events[eventIndex]
        eventIndex += 1
        if (event === undefined) throw new TypeError("missing Cursor event")
        if (event.kind === "headers") {
          return { kind: "headers", id: input.id, status: event.status, headers: {} }
        }
        return {
          kind: "data",
          id: input.id,
          payload: encodeConnectFrame(
            encodeAgentServerMessage({
              kind: "interaction-update",
              update: { kind: "turn-ended" },
            }),
          ),
        }
      },
      abort: async () => {
        aborts += 1
        if (attempt.abortFails === true) throw new TypeError("retirement failed")
      },
      close: async () => undefined,
    }
  }
  const dispose = async (): Promise<void> => undefined
  return {
    client: { pid: 1, open, dispose, [Symbol.asyncDispose]: dispose },
    tokens,
    aborts: () => aborts,
  }
}

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }]

function runtimeFor(
  fixture: ReturnType<typeof bridgeFixture>,
  readAccessToken: (signal: AbortSignal) => Promise<string | null>,
) {
  return createCursorDirectRuntime({
    clock: new FakeClock(),
    createId: ids(),
    readAccessToken,
    onBackgroundCleanupError: () => undefined,
    createBridgeClient: async () => fixture.client,
  })
}

async function streamFailure(
  runtime: ReturnType<typeof createCursorDirectRuntime>,
): Promise<unknown> {
  const result = await runtime.doStream({ prompt }, "auto")
  return Array.fromAsync(result.stream).then(
    () => new TypeError("expected stream failure"),
    (error: unknown) => error,
  )
}

describe("Cursor direct credential retry", () => {
  it("reloads a changed token once and completes through one outward stream", async () => {
    // Given
    const fixture = bridgeFixture([
      { events: [{ kind: "headers", status: 401 }] },
      { events: [{ kind: "headers", status: 200 }, { kind: "turn-ended" }] },
    ])
    const reads = ["old-token", "new-token"]
    const runtime = runtimeFor(fixture, async () => reads.shift() ?? null)

    // When
    const parts = await Array.fromAsync((await runtime.doStream({ prompt }, "auto")).stream)

    // Then
    expect(fixture.tokens).toEqual(["old-token", "new-token"])
    expect(fixture.aborts()).toBe(1)
    expect(parts.filter((part) => part.type === "stream-start")).toHaveLength(1)
    expect(parts.filter((part) => part.type === "finish")).toHaveLength(1)
    await runtime.dispose()
  })

  it.each([
    ["unchanged", "old-token"],
    ["missing", null],
  ])("keeps a 401 terminal when the reloaded token is %s", async (_name, reloaded) => {
    // Given
    const fixture = bridgeFixture([{ events: [{ kind: "headers", status: 401 }] }])
    const reads: Array<string | null> = ["old-token", reloaded]
    const runtime = runtimeFor(fixture, async () => reads.shift() ?? null)

    // When
    const failure = await streamFailure(runtime)

    // Then
    expect(failure).toBeInstanceOf(CursorRecoveryError)
    expect(fixture.tokens).toEqual(["old-token"])
    await runtime.dispose()
  })

  it("does not reload or retry a 403", async () => {
    // Given
    const fixture = bridgeFixture([{ events: [{ kind: "headers", status: 403 }] }])
    let reads = 0
    const runtime = runtimeFor(fixture, async () => (++reads === 1 ? "old-token" : "new-token"))

    // When
    await streamFailure(runtime)

    // Then
    expect(reads).toBe(1)
    expect(fixture.tokens).toEqual(["old-token"])
    await runtime.dispose()
  })

  it("uses the auth retry budget after a changed token", async () => {
    // Given
    const fixture = bridgeFixture([
      { events: [{ kind: "headers", status: 401 }] },
      { events: [{ kind: "headers", status: 401 }] },
    ])
    const reads = ["old-token", "new-token", "third-token"]
    const runtime = runtimeFor(fixture, async () => reads.shift() ?? null)

    // When
    await streamFailure(runtime)

    // Then
    expect(fixture.tokens).toEqual(["old-token", "new-token"])
    expect(reads).toEqual(["third-token"])
    await runtime.dispose()
  })

  it("cancels without opening a retry when aborted during credential reread", async () => {
    // Given
    const fixture = bridgeFixture([{ events: [{ kind: "headers", status: 401 }] }])
    const reload = Promise.withResolvers<string | null>()
    const reloadStarted = Promise.withResolvers<void>()
    let reads = 0
    const abort = new AbortController()
    const runtime = runtimeFor(fixture, async () => {
      reads += 1
      if (reads === 1) return "old-token"
      reloadStarted.resolve()
      return reload.promise
    })
    const result = await runtime.doStream({ prompt, abortSignal: abort.signal }, "auto")
    const consumed = Array.fromAsync(result.stream)
    await reloadStarted.promise

    // When
    abort.abort()
    reload.resolve("new-token")

    // Then
    await expect(consumed).rejects.toBeInstanceOf(OperationCancelledError)
    expect(fixture.tokens).toEqual(["old-token"])
    await runtime.dispose()
  })

  it("cancels a pending credential reread when the runtime is disposed", async () => {
    // Given
    const fixture = bridgeFixture([{ events: [{ kind: "headers", status: 401 }] }])
    const reload = Promise.withResolvers<string | null>()
    const reloadStarted = Promise.withResolvers<void>()
    const reloadAborted = Promise.withResolvers<unknown>()
    let reads = 0
    const runtime = runtimeFor(fixture, (signal) => {
      reads += 1
      if (reads === 1) return Promise.resolve("old-token")
      signal.addEventListener("abort", () => reloadAborted.resolve(signal.reason), { once: true })
      reloadStarted.resolve()
      return reload.promise
    })
    const result = await runtime.doStream({ prompt }, "auto")
    const consumed = Array.fromAsync(result.stream)
    await reloadStarted.promise

    // When
    const cleanup = runtime.dispose()
    const cancellation = await reloadAborted.promise
    reload.resolve("new-token")

    // Then
    expect(cancellation).toBeInstanceOf(OperationCancelledError)
    if (!(cancellation instanceof OperationCancelledError)) {
      throw new TypeError("expected Cursor direct cancellation")
    }
    expect(cancellation.operation).toBe("cursor-direct-stream")
    await expect(consumed).rejects.toEqual(cancellation)
    expect(fixture.tokens).toEqual(["old-token"])
    await expect(cleanup).resolves.toBeUndefined()
  })

  it("keeps retirement failure terminal without opening the changed-token attempt", async () => {
    // Given
    const fixture = bridgeFixture([
      { events: [{ kind: "headers", status: 401 }], abortFails: true },
    ])
    const reads = ["old-token", "new-token"]
    const runtime = runtimeFor(fixture, async () => reads.shift() ?? null)

    // When
    const failure = await streamFailure(runtime)

    // Then
    expect(failure).toBeInstanceOf(AggregateError)
    expect(fixture.tokens).toEqual(["old-token"])
    await runtime.dispose().catch(() => undefined)
  })
})
