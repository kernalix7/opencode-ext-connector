// Derived from Nomadcxx/opencode-cursor (pool key/idle/cancel). Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import type { Clock } from "../../core/clock"
import { createAsyncDisposable } from "../../core/lifecycle"

export type CursorPooledChild = {
  readonly kill: () => void
  readonly cancel: (requestId: string) => void
  readonly writePrompt: (prompt: string) => void
  readonly isAlive: () => boolean
  readonly lines: AsyncIterable<string>
}

type PoolEntry = {
  readonly child: CursorPooledChild
  idleTimer: ReturnType<Clock["schedule"]> | null
}

export type CursorAgentPoolSpawn = (
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly env: Readonly<Record<string, string | undefined>>
  },
) => CursorPooledChild

export type CursorAgentPoolOptions = {
  readonly clock: Clock
  readonly spawn: CursorAgentPoolSpawn
  readonly idleMs?: number
  readonly env?: Readonly<Record<string, string | undefined>>
}

export type CursorAcquireInput = {
  readonly workspace: string
  readonly model: string
  readonly executable: string
  readonly resume?: string
}

export type CursorAgentPool = {
  readonly buildCursorPoolKey: (workspace: string, model: string) => string
  readonly acquire: (
    input: CursorAcquireInput,
  ) => Promise<{ readonly reused: boolean; readonly child: CursorPooledChild }>
  readonly cancel: (requestId: string) => void
  readonly dispose: () => Promise<void>
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

export function buildCursorPoolKey(workspace: string, model: string): string {
  return `${workspace}\0${model}`
}

export function createCursorAgentPool(options: CursorAgentPoolOptions): CursorAgentPool {
  const idleMs = options.idleMs ?? 15 * 60 * 1000
  const env = options.env ?? {}
  const pool = new Map<string, PoolEntry>()

  const evict = (key: string): void => {
    const current = pool.get(key)
    if (current === undefined) {
      return
    }
    current.idleTimer?.cancel()
    current.child.kill()
    pool.delete(key)
  }

  const armIdle = (key: string, entry: PoolEntry): void => {
    entry.idleTimer?.cancel()
    entry.idleTimer = options.clock.schedule(idleMs, () => {
      evict(key)
    })
  }

  const acquire = async (
    input: CursorAcquireInput,
  ): Promise<{ readonly reused: boolean; readonly child: CursorPooledChild }> => {
    const key = buildCursorPoolKey(input.workspace, input.model)
    const existing = pool.get(key)
    if (existing?.child.isAlive() === true) {
      armIdle(key, existing)
      return { reused: true, child: existing.child }
    }
    if (existing !== undefined) {
      evict(key)
    }
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--workspace",
      input.workspace,
      "--model",
      input.model,
    ]
    if (input.resume !== undefined) {
      args.push("--resume", input.resume)
    }
    const child = options.spawn(input.executable, args, { cwd: input.workspace, env })
    const entry: PoolEntry = { child, idleTimer: null }
    pool.set(key, entry)
    armIdle(key, entry)
    return { reused: false, child: child }
  }

  const cancel = (requestId: string): void => {
    for (const entry of pool.values()) {
      entry.child.cancel(requestId)
    }
  }

  const disposal = createAsyncDisposable(() => {
    for (const key of [...pool.keys()]) {
      evict(key)
    }
  })

  return {
    buildCursorPoolKey,
    acquire,
    cancel,
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: (): Promise<void> => disposal.dispose(),
  }
}
