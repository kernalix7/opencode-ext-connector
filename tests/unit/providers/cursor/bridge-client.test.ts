import { describe, expect, it } from "bun:test"

import { OperationCancelledError, ResourceDisposedError } from "../../../../src/core/errors"
import {
  CursorBridgeSessionError,
  createCursorBridgeClient,
} from "../../../../src/providers/cursor/bridge-client"
import {
  CursorBridgeProcessError,
  CursorBridgeUnavailableError,
  createNodeCursorBridgeProcessFactory,
} from "../../../../src/providers/cursor/bridge-process"
import { CursorBridgeProtocolError } from "../../../../src/providers/cursor/bridge-protocol"
import {
  FakeCursorBridgeProcess,
  FakeCursorBridgeProcessFactory,
} from "../../../support/cursor-bridge-process"

const token = "unit-secret-token"
const openInput = {
  id: "run-1",
  accessToken: token,
  path: "/agent.v1.AgentService/Run",
  headers: { "x-parent": "allowed" },
}

describe("Cursor bridge Node process factory", () => {
  for (const fixture of [
    { version: "v21.9.0", reason: "unsupported-node" },
    { version: "22.0.0", reason: "malformed-node-version" },
    { version: "misleading v24.0.0 output", reason: "malformed-node-version" },
  ] as const) {
    it(`rejects ${fixture.version} without spawning`, async () => {
      // Given
      let spawnCount = 0
      const factory = createNodeCursorBridgeProcessFactory({
        probeVersion: async () => fixture.version,
        spawnBridge: async () => {
          spawnCount += 1
          return new FakeCursorBridgeProcess()
        },
      })

      // When
      const result = factory.start(new AbortController().signal)

      // Then
      expect(result).rejects.toEqual(expect.objectContaining({ reason: fixture.reason }))
      await result.catch(() => undefined)
      expect(spawnCount).toBe(0)
    })
  }

  it("accepts Node 22 and starts the private child without credential env or argv", async () => {
    // Given
    const child = new FakeCursorBridgeProcess()
    let invocation:
      | { readonly arguments: readonly string[]; readonly env: Readonly<Record<string, string>> }
      | undefined
    const factory = createNodeCursorBridgeProcessFactory({
      nodeExecutable: "/opt/node-22",
      probeVersion: async () => "v22.0.0\n",
      spawnBridge: async (input) => {
        invocation = input
        return child
      },
      endpoint: "http://127.0.0.1:4242",
      env: {
        PATH: "/usr/bin",
        ACCESS_TOKEN: token,
        OPENCODE_CURSOR_H2_ENDPOINT: "https://attacker.example",
      },
    })

    // When
    const started = await factory.start(new AbortController().signal)

    // Then
    expect(started).toBe(child)
    expect(invocation?.arguments.at(1)).toBe("http://127.0.0.1:4242")
    expect(JSON.stringify(invocation)).not.toContain(token)
    expect(invocation?.env).toEqual({ PATH: "/usr/bin" })
  })

  it("maps a missing Node executable to Cursor-only unavailable", async () => {
    // Given
    const factory = createNodeCursorBridgeProcessFactory({
      probeVersion: async () => {
        throw new Error("spawn node ENOENT token=should-not-surface")
      },
    })

    // When
    const result = factory.start(new AbortController().signal)

    // Then
    expect(result).rejects.toBeInstanceOf(CursorBridgeUnavailableError)
    await expect(result).rejects.not.toThrow("should-not-surface")
  })
})

describe("Cursor bridge client", () => {
  it("starts once and preserves open, write, abort ordering", async () => {
    // Given
    const child = new FakeCursorBridgeProcess()
    const factory = new FakeCursorBridgeProcessFactory(child)
    const client = await createCursorBridgeClient({ processFactory: factory })

    // When
    const stream = await client.open({ ...openInput, signal: new AbortController().signal })
    await stream.write(new Uint8Array([1, 2]))
    await stream.abort()

    // Then
    expect(factory.startCount).toBe(1)
    expect(child.commands.map((command) => command.kind)).toEqual(["open", "write-frame", "abort"])
    expect(JSON.stringify(child.commands)).not.toContain(token)
    await client.dispose()
  })

  it("routes events only to the matching stream and rejects reused ids", async () => {
    // Given
    const child = new FakeCursorBridgeProcess()
    const client = await createCursorBridgeClient({
      processFactory: new FakeCursorBridgeProcessFactory(child),
    })
    const first = await client.open({ ...openInput, signal: new AbortController().signal })
    const second = await client.open({
      ...openInput,
      id: "run-2",
      signal: new AbortController().signal,
    })

    // When
    child.emit({ kind: "opened", id: "run-2" })
    child.emit({ kind: "opened", id: "run-1" })

    // Then
    expect((await first.nextEvent()).id).toBe("run-1")
    expect((await second.nextEvent()).id).toBe("run-2")
    await first.close()
    await expect(
      client.open({ ...openInput, signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(CursorBridgeSessionError)
    await client.dispose()
  })

  it("propagates cancellation once while an open write is backpressured", async () => {
    // Given
    const child = new FakeCursorBridgeProcess()
    child.blockWrites()
    const controller = new AbortController()
    const client = await createCursorBridgeClient({
      processFactory: new FakeCursorBridgeProcessFactory(child),
    })

    // When
    const opening = client.open({ ...openInput, signal: controller.signal })
    controller.abort()
    child.releaseWrites()
    const stream = await opening

    // Then
    await expect(stream.nextEvent()).rejects.toBeInstanceOf(OperationCancelledError)
    expect(child.commands.map((command) => command.kind)).toEqual(["open", "abort"])
    await client.dispose()
  })

  it("cancels a blocked frame write before sending one ordered stream abort", async () => {
    // Given
    const child = new FakeCursorBridgeProcess()
    const controller = new AbortController()
    const client = await createCursorBridgeClient({
      processFactory: new FakeCursorBridgeProcessFactory(child),
    })
    const stream = await client.open({ ...openInput, signal: controller.signal })
    child.blockWrites()
    const writing = stream.write(new Uint8Array([3, 4]), controller.signal)
    await child.waitForBlockedWrite()

    // When
    controller.abort()

    // Then
    try {
      expect(child.writeSignals.at(-1)).toBe(controller.signal)
      await expect(writing).rejects.toBeInstanceOf(OperationCancelledError)
      await stream.abort()
      expect(child.commands.map((command) => command.kind)).toEqual([
        "open",
        "write-frame",
        "abort",
      ])
    } finally {
      child.releaseWrites()
      await writing.catch(() => undefined)
      await client.dispose()
    }
  })

  it("fails pending events on malformed child output", async () => {
    // Given
    const child = new FakeCursorBridgeProcess()
    const client = await createCursorBridgeClient({
      processFactory: new FakeCursorBridgeProcessFactory(child),
    })
    const stream = await client.open({ ...openInput, signal: new AbortController().signal })

    // When
    const pending = stream.nextEvent()
    child.emitRaw("{malformed\n")

    // Then
    await expect(pending).rejects.toBeInstanceOf(CursorBridgeProtocolError)
    await client.dispose()
  })

  it("fails pending events when the child crashes without leaking stderr", async () => {
    // Given
    const child = new FakeCursorBridgeProcess()
    const client = await createCursorBridgeClient({
      processFactory: new FakeCursorBridgeProcessFactory(child),
    })
    const stream = await client.open({ ...openInput, signal: new AbortController().signal })

    // When
    const pending = stream.nextEvent()
    child.crash(`authorization: Bearer ${token}`)

    // Then
    const failure = await pending.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CursorBridgeProcessError)
    expect(JSON.stringify(failure)).not.toContain(token)
    await client.dispose()
  })

  it("disposes with the exact same promise, terminates, and rejects pending waiters", async () => {
    // Given
    const child = new FakeCursorBridgeProcess()
    const client = await createCursorBridgeClient({
      processFactory: new FakeCursorBridgeProcessFactory(child),
    })
    const stream = await client.open({ ...openInput, signal: new AbortController().signal })
    const pending = stream.nextEvent()

    // When
    const first = client.dispose()
    const second = client.dispose()

    // Then
    expect(first).toBe(second)
    await first
    expect(child.terminationCount).toBe(1)
    await expect(pending).rejects.toBeInstanceOf(ResourceDisposedError)
  })
})
