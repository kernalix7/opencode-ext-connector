import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { OperationCancelledError } from "../../core/errors"

function accessTokenFromUnknown(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  if ("claudeAiOauth" in value) {
    const oauth = value.claudeAiOauth
    if (typeof oauth === "object" && oauth !== null && "accessToken" in oauth) {
      const token = oauth.accessToken
      if (typeof token === "string" && token.length > 0) {
        return token
      }
    }
  }
  if ("accessToken" in value) {
    const token = value.accessToken
    if (typeof token === "string" && token.length > 0) {
      return token
    }
  }
  return null
}

export async function readClaudeAccessToken(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("claude-read-credentials")
  }
  const configDir = env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude")
  const credentialPath = join(configDir, ".credentials.json")
  try {
    const text = await readFile(credentialPath, "utf8")
    const parsed: unknown = JSON.parse(text)
    return accessTokenFromUnknown(parsed)
  } catch {
    return null
  }
}
