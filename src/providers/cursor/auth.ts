import { access, readFile } from "node:fs/promises"
import { delimiter, join } from "node:path"

import { OperationCancelledError } from "../../core/errors.js"
import { type CursorCredentials, parseCursorCredentials } from "./credentials.js"

export type CursorAuthLookup = {
  readonly readAuthFile?: (path: string, signal: AbortSignal) => Promise<CursorCredentials | null>
}

async function defaultReadAuthFile(
  path: string,
  signal: AbortSignal,
): Promise<CursorCredentials | null> {
  try {
    const text = await readFile(path, { encoding: "utf8", signal })
    return parseCursorCredentials(JSON.parse(text))
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

export async function readCursorAccessToken(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  lookup: CursorAuthLookup = {},
): Promise<string | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("cursor-read-token")
  }
  const envToken = env["CURSOR_ACCESS_TOKEN"]
  if (typeof envToken === "string" && envToken.length > 0) {
    return envToken
  }
  const home = env["HOME"]
  if (home === undefined || home.length === 0) {
    return null
  }
  const readAuthFile = lookup.readAuthFile ?? defaultReadAuthFile
  const credentials = await readAuthFile(join(home, ".config/cursor/auth.json"), signal)
  return credentials === null ? null : credentials.accessToken
}

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
