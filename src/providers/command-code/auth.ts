import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { OperationCancelledError } from "../../core/errors"

function tokenFromUnknown(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  for (const [key, token] of Object.entries(value)) {
    if (
      (key === "apiKey" || key === "accessToken" || key === "token") &&
      typeof token === "string" &&
      token.length > 0
    ) {
      return token
    }
  }
  return null
}

export async function readCommandCodeAccessToken(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("command-code-read-credentials")
  }
  const envToken = env["COMMANDCODE_API_KEY"] ?? env["CC_API_KEY"]
  if (envToken !== undefined && envToken.length > 0) {
    return envToken
  }
  const home = homedir()
  const candidates = [
    join(home, ".commandcode", "auth.json"),
    join(home, ".config", "commandcode", "auth.json"),
    join(home, ".config", "command-code", "auth.json"),
  ]
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(await readFile(candidate, "utf8"))
      const token = tokenFromUnknown(parsed)
      if (token !== null) {
        return token
      }
    } catch {}
  }
  return null
}
