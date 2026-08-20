import { describe, expect, it } from "bun:test"

import { createCursorAgentPool } from "../../../../src/providers/cursor/pool"
import { FakeClock } from "../../../support/clock"

type FakeChild = {
  readonly kill: () => void
  readonly cancel: (requestId: string) => void
  readonly writePrompt: (prompt: string) => void
  readonly isAlive: () => boolean
  readonly lines: AsyncIterable<string>
  readonly cancelCalls: string[]
}

function createHarness() {
  const clock = new FakeClock(0)
  let spawnCount = 0
  let lastSpawnArgs: readonly string[] | null = null
  let lastSpawnCwd: string | null = null
  let killCount = 0
  const children: FakeChild[] = []
  const spawn = (
    _executable: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> },
  ): FakeChild => {
    spawnCount += 1
    lastSpawnArgs = args
    lastSpawnCwd = options.cwd
    const cancelCalls: string[] = []
    let alive = true
    const child: FakeChild = {
      kill: (): void => {
        alive = false
        killCount += 1
      },
      cancel: (requestId: string): void => {
        cancelCalls.push(requestId)
      },
      writePrompt: (_prompt: string): void => undefined,
      isAlive: (): boolean => alive,
      lines: (async function* () {})(),
      cancelCalls,
    }
    children.push(child)
    return child
  }
  return {
    clock,
    spawn,
    snapshot: () => ({ spawnCount, lastSpawnArgs, lastSpawnCwd, killCount, children }),
  }
}

describe("createCursorAgentPool", () => {
  it("buildCursorPoolKey returns workspace\\0model", () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    // When
    const key = pool.buildCursorPoolKey("/workspace", "auto")
    // Then
    expect(key).toBe("/workspace\0auto")
  })

  it("acquire spawns new child for new key", async () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    // When
    const result = await pool.acquire({
      workspace: "/ws",
      model: "auto",
      executable: "cursor-agent",
    })
    // Then
    const snap = harness.snapshot()
    expect(result.reused).toBe(false)
    expect(snap.spawnCount).toBe(1)
    expect(snap.lastSpawnArgs).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--workspace",
      "/ws",
      "--model",
      "auto",
      "--force",
    ])
    expect(snap.lastSpawnCwd).toBe("/ws")
  })

  it("acquire replaces a completed one-shot child for the same key", async () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    await pool.acquire({ workspace: "/ws", model: "auto", executable: "cursor-agent" })
    // When
    const result = await pool.acquire({
      workspace: "/ws",
      model: "auto",
      executable: "cursor-agent",
    })
    // Then
    expect(result.reused).toBe(false)
    expect(harness.snapshot().spawnCount).toBe(2)
    expect(harness.snapshot().killCount).toBe(1)
  })

  it("acquire spawns new child for different model", async () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    await pool.acquire({ workspace: "/ws", model: "auto", executable: "cursor-agent" })
    // When
    const result = await pool.acquire({
      workspace: "/ws",
      model: "claude-3",
      executable: "cursor-agent",
    })
    // Then
    expect(result.reused).toBe(false)
    expect(harness.snapshot().spawnCount).toBe(2)
  })

  it("isolates concurrent conversations with different session keys", async () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    await pool.acquire({
      workspace: "/ws",
      model: "auto",
      executable: "cursor-agent",
      sessionKey: "title-request",
    })
    // When
    await pool.acquire({
      workspace: "/ws",
      model: "auto",
      executable: "cursor-agent",
      sessionKey: "chat-request",
    })
    // Then
    expect(harness.snapshot().spawnCount).toBe(2)
  })

  it("acquire includes --resume when resume provided", async () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    // When
    await pool.acquire({
      workspace: "/ws",
      model: "auto",
      executable: "cursor-agent",
      resume: "session-123",
    })
    // Then
    expect(harness.snapshot().lastSpawnArgs).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--workspace",
      "/ws",
      "--model",
      "auto",
      "--resume",
      "session-123",
      "--force",
    ])
  })

  it("dispose kills all children once", async () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    await pool.acquire({ workspace: "/ws1", model: "auto", executable: "cursor-agent" })
    await pool.acquire({ workspace: "/ws2", model: "auto", executable: "cursor-agent" })
    // When
    await pool.dispose()
    // Then
    expect(harness.snapshot().killCount).toBe(2)
  })

  it("second dispose is idempotent", async () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    await pool.acquire({ workspace: "/ws", model: "auto", executable: "cursor-agent" })
    await pool.dispose()
    // When
    await pool.dispose()
    // Then
    expect(harness.snapshot().killCount).toBe(1)
  })

  it("idle eviction: after clock.advanceBy(idleMs), next acquire spawns again", async () => {
    // Given
    const idleMs = 15 * 60 * 1000
    const harness = createHarness()
    const pool = createCursorAgentPool({
      clock: harness.clock,
      spawn: harness.spawn,
      idleMs,
    })
    await pool.acquire({ workspace: "/ws", model: "auto", executable: "cursor-agent" })
    expect(harness.snapshot().spawnCount).toBe(1)
    // When
    harness.clock.advanceBy(idleMs)
    const result = await pool.acquire({
      workspace: "/ws",
      model: "auto",
      executable: "cursor-agent",
    })
    // Then
    expect(result.reused).toBe(false)
    expect(harness.snapshot().spawnCount).toBe(2)
  })

  it("replaces one-shot children even before idle eviction", async () => {
    // Given
    const idleMs = 15 * 60 * 1000
    const harness = createHarness()
    const pool = createCursorAgentPool({
      clock: harness.clock,
      spawn: harness.spawn,
      idleMs,
    })
    await pool.acquire({ workspace: "/ws", model: "auto", executable: "cursor-agent" })
    // When
    harness.clock.advanceBy(idleMs - 1)
    const result = await pool.acquire({
      workspace: "/ws",
      model: "auto",
      executable: "cursor-agent",
    })
    // Then
    expect(result.reused).toBe(false)
    expect(harness.snapshot().spawnCount).toBe(2)
  })

  it("cancel writes control payload to child", async () => {
    // Given
    const harness = createHarness()
    const pool = createCursorAgentPool({ clock: harness.clock, spawn: harness.spawn })
    await pool.acquire({ workspace: "/ws", model: "auto", executable: "cursor-agent" })
    const child = harness.snapshot().children.at(0)
    // When
    pool.cancel("request-123")
    // Then
    expect(child?.cancelCalls).toEqual(["request-123"])
  })
})
