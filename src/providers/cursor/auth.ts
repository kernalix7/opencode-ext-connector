import { access } from "node:fs/promises"
import { delimiter } from "node:path"

import { OperationCancelledError } from "../../core/errors"

export async function resolveCursorAgent(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("cursor-resolve-agent")
  }
  const pathValue = env["PATH"]
  if (pathValue === undefined || pathValue.length === 0) {
    return null
  }
  const names = ["cursor-agent", "cursor-agent.exe"]
  for (const directory of pathValue.split(delimiter)) {
    for (const name of names) {
      const candidate = `${directory}/${name}`
      try {
        await access(candidate)
        return candidate
      } catch {}
    }
  }
  return null
}
