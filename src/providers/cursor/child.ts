// Derived from Nomadcxx/opencode-cursor (spawn/cancel). Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import { spawn } from "node:child_process"

import type { CursorPooledChild } from "./pool"

export function spawnCursorPooledChild(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly env: Readonly<Record<string, string | undefined>>
  },
): CursorPooledChild {
  const child = spawn(executable, [...args], {
    cwd: options.cwd,
    env: { ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let alive = true
  child.once("close", () => {
    alive = false
  })
  child.once("error", () => {
    alive = false
  })
  return {
    kill: (): void => {
      alive = false
      child.kill("SIGTERM")
    },
    cancel: (requestId: string): void => {
      child.stdin.write(`${JSON.stringify({ cancel: requestId })}\n`)
      alive = false
      child.kill("SIGTERM")
    },
    writePrompt: (prompt: string): void => {
      child.stdin.write(prompt)
      child.stdin.end()
    },
    isAlive: (): boolean => alive,
    lines: (async function* (): AsyncGenerator<string> {
      let buffer = ""
      for await (const chunk of child.stdout) {
        buffer += chunk.toString("utf8")
        const parts = buffer.split("\n")
        buffer = parts.pop() ?? ""
        for (const line of parts) {
          const trimmed = line.trim()
          if (trimmed.length > 0) {
            yield trimmed
          }
        }
      }
      const trailing = buffer.trim()
      if (trailing.length > 0) {
        yield trailing
      }
    })(),
  }
}
