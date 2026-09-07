import { describe, expect, it } from "bun:test"

import type {
  CursorBridgeClient,
  CursorBridgeOpenInput,
  CursorBridgeStream,
} from "../../../../src/providers/cursor/bridge-client"
import type { CursorDirectSetupCleanupResources } from "../../../../src/providers/cursor/direct-run-types"
import { createCursorDirectRuntime } from "../../../../src/providers/cursor/direct-runtime"
import { CursorDirectStreamError } from "../../../../src/providers/cursor/direct-stream"
import { FakeClock } from "../../../support/clock"

type FailureKind = "credential" | "recovery"

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }]

function ids(): () => string {
  let next = 0
  return (): string => `replacement-cleanup-${++next}`
}

function initialStream(
  kind: FailureKind,
  order: string[],
  abortFailures: readonly Error[] = [],
): CursorBridgeStream {
  let aborts = 0
  return {
    id: "initial-stream",
    write: async () => undefined,
    nextEvent: async () => ({
      kind: "headers",
      id: "initial-stream",
      status: kind === "credential" ? 401 : 500,
      headers: {},
    }),
    abort: async () => {
      order.push("retire")
      const failure = abortFailures[aborts]
      aborts += 1
      if (failure !== undefined) throw failure
    },
    close: async () => undefined,
  }
}

function collectErrors(error: unknown, collected: Error[] = []): readonly Error[] {
  if (!(error instanceof Error)) return collected
  collected.push(error)
  if (error instanceof AggregateError) {
    for (const nested of Array.from<unknown>(error.errors)) collectErrors(nested, collected)
  }
  return collected
}

function createCleanup(resources: CursorDirectSetupCleanupResources, order: string[]) {
  return {
    releaseOwnership: resources.ownership.release,
    invalidateCheckpoint: (): void => {
      order.push("invalidate-checkpoint")
      resources.checkpointStore.invalidate(resources.sessionId)
    },
    invalidateSession: (): void => {
      order.push("invalidate-session")
      resources.sessionStore.invalidate(resources.sessionId)
    },
  }
}

describe("Cursor direct replacement cleanup", () => {
  it.each(["credential", "recovery"] satisfies readonly FailureKind[])(
    "invalidates logical stores once when the %s replacement cannot open",
    async (kind) => {
      // Given
      const order: string[] = []
      const replacementFailure = new TypeError(`${kind} replacement open failed`)
      let opens = 0
      const open = async (_input: CursorBridgeOpenInput): Promise<CursorBridgeStream> => {
        opens += 1
        if (opens === 1) return initialStream(kind, order)
        order.push("open-replacement")
        throw replacementFailure
      }
      const dispose = async (): Promise<void> => undefined
      const client: CursorBridgeClient = {
        pid: 1,
        open,
        dispose,
        [Symbol.asyncDispose]: dispose,
      }
      const tokens = ["old-token", "new-token"]
      const runtime = createCursorDirectRuntime({
        clock: new FakeClock(),
        createId: ids(),
        readAccessToken: async () => tokens.shift() ?? null,
        onBackgroundCleanupError: () => undefined,
        createBridgeClient: async () => client,
        createSetupCleanup: (resources) => createCleanup(resources, order),
      })
      const result = await runtime.doStream({ prompt }, "auto")

      // When
      const failure = await Array.fromAsync(result.stream).then(
        () => new TypeError("expected replacement open failure"),
        (error: unknown) => error,
      )
      await runtime.dispose()

      // Then
      expect(failure).toBe(replacementFailure)
      expect(order).toEqual([
        "retire",
        "open-replacement",
        "invalidate-checkpoint",
        "invalidate-session",
      ])
    },
  )

  it.each([
    ["credential", "http-401"],
    ["recovery", "http-500"],
  ] satisfies readonly (readonly [FailureKind, string])[])(
    "preserves the %s trigger when retirement and abort cleanup fail",
    async (kind, bridgeCode) => {
      // Given
      const order: string[] = []
      const retirementFailure = new TypeError("retry retirement failed")
      const abortFailure = new TypeError("abort cleanup failed")
      let opens = 0
      const open = async (_input: CursorBridgeOpenInput): Promise<CursorBridgeStream> => {
        opens += 1
        if (opens === 1) {
          return initialStream(kind, order, [retirementFailure, abortFailure])
        }
        throw new TypeError("unexpected replacement open")
      }
      const dispose = async (): Promise<void> => undefined
      const client: CursorBridgeClient = {
        pid: 1,
        open,
        dispose,
        [Symbol.asyncDispose]: dispose,
      }
      const tokens = ["old-token", "new-token"]
      const runtime = createCursorDirectRuntime({
        clock: new FakeClock(),
        createId: ids(),
        readAccessToken: async () => tokens.shift() ?? null,
        onBackgroundCleanupError: () => undefined,
        createBridgeClient: async () => client,
        createSetupCleanup: (resources) => createCleanup(resources, order),
      })
      const result = await runtime.doStream({ prompt }, "auto")

      // When
      const failure = await Array.fromAsync(result.stream).then(
        () => new TypeError("expected retirement cleanup failure"),
        (error: unknown) => error,
      )
      await runtime.dispose()

      // Then
      const errors = collectErrors(failure)
      const streamFailure = errors.find((error) => error instanceof CursorDirectStreamError)
      expect(streamFailure).toBeInstanceOf(CursorDirectStreamError)
      if (!(streamFailure instanceof CursorDirectStreamError)) throw streamFailure
      expect(streamFailure.bridgeCode).toBe(bridgeCode)
      expect(errors.map((error) => error.message)).toContain(retirementFailure.message)
      expect(errors.map((error) => error.message)).toContain(abortFailure.message)
      expect(order.filter((entry) => entry === "retire")).toHaveLength(2)
      expect(opens).toBe(1)
    },
  )
})
