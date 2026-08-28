import { describe, expect, it } from "bun:test"

import { createCursorRunSessionRegistry } from "../../../../src/providers/cursor/run-session"
import { buildCursorToolContinuations } from "../../../../src/providers/cursor/tool-continuation"
import { FakeClock } from "../../../support/clock"
import { cursorRunSessionResources as resources } from "../../../support/cursor-run-session"

const ignoreBackgroundCleanupError = (): void => undefined

function continuationPrompt(callId: string) {
  return [
    { role: "user" as const, content: [{ type: "text" as const, text: "continue" }] },
    {
      role: "assistant" as const,
      content: [{ type: "tool-call" as const, toolCallId: callId, toolName: "read", input: {} }],
    },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: callId,
          toolName: "read",
          output: { type: "text" as const, value: `result-${callId}` },
        },
      ],
    },
  ]
}

describe("Cursor Run parked-call rounds", () => {
  it("resolves equal call IDs independently across models", async () => {
    // Given
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 100,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const modelA = registry.register(
      resources({ key: "model-a-session", modelId: "model-a", callIds: ["shared-call"] }),
    )
    const modelB = registry.register(
      resources({ key: "model-b-session", modelId: "model-b", callIds: ["shared-call"] }),
    )
    modelA.touch()
    modelB.touch()

    // When
    const resolvedA = registry.resolveParkedCalls(["shared-call"], "model-a")
    const resolvedB = registry.resolveParkedCalls(["shared-call"], "model-b")

    // Then
    expect(resolvedA).toBe(modelA)
    expect(resolvedB).toBe(modelB)
    await registry.dispose()
  })

  it("retires committed calls before a later tool round on the same Run", async () => {
    // Given
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 100,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const writes: Uint8Array[] = []
    const fixture = resources({ key: "first", callIds: ["call-a"], writes })
    const session = registry.register(fixture)
    session.touch()
    const first = buildCursorToolContinuations(
      continuationPrompt("call-a"),
      session.dispatcher.parkedCalls,
    )
    await session.writeContinuations(first)
    fixture.parkedCalls.set("call-b", {
      callId: "call-b",
      execId: "exec-call-b",
      execMessageId: 8,
      args: {
        name: "read",
        args: {},
        toolCallId: "call-b",
        providerIdentifier: "opencode",
        toolName: "read",
      },
    })
    session.touch()

    // When
    const second = buildCursorToolContinuations(
      continuationPrompt("call-b"),
      session.dispatcher.parkedCalls,
    )
    await session.writeContinuations(second)

    // Then
    expect(writes).toHaveLength(2)
    expect(fixture.parkedCalls.size).toBe(0)
    await expect(session.writeContinuations(first)).rejects.toMatchObject({
      reason: "duplicate-result",
    })
    await registry.dispose()
  })

  it("keeps unresolved calls until a failed transaction poisons the session", async () => {
    // Given
    const registry = createCursorRunSessionRegistry({
      clock: new FakeClock(),
      ttlMs: 100,
      onBackgroundCleanupError: ignoreBackgroundCleanupError,
    })
    const secondWrite = Promise.withResolvers<void>()
    let writeCount = 0
    const fixture = resources({
      key: "first",
      callIds: ["call-a", "call-b"],
      write: () => {
        writeCount += 1
        return writeCount === 1 ? Promise.resolve() : secondWrite.promise
      },
    })
    const session = registry.register(fixture)
    session.touch()
    const transaction = session.writeContinuations([
      { callId: "call-a", frame: new Uint8Array([1]) },
      { callId: "call-b", frame: new Uint8Array([2]) },
    ])
    await Promise.resolve()
    await Promise.resolve()

    // When
    const parkedBeforeFailure = [...fixture.parkedCalls.keys()]
    secondWrite.reject(new Error("uncertain write"))

    // Then
    expect(parkedBeforeFailure).toEqual(["call-a", "call-b"])
    await expect(transaction).rejects.toThrow("uncertain write")
    expect(fixture.parkedCalls.size).toBe(0)
    expect(registry.size()).toBe(0)
    await registry.dispose()
  })
})
