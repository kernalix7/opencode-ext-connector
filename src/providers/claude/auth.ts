import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { OperationCancelledError } from "../../core/errors"

const execFileAsync = promisify(execFile)
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials"

export type ClaudeAuthLookup = {
  readonly readKeychain?: (service: string, signal: AbortSignal) => Promise<string | null>
}

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

function tokenFromKeychainRaw(raw: string): string | null {
  try {
    return accessTokenFromUnknown(JSON.parse(raw))
  } catch {
    return null
  }
}

async function defaultReadKeychain(_service: string, signal: AbortSignal): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null
  }
  try {
    const result = await execFileAsync(
      "security",
      ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
      { timeout: 2_000, signal },
    )
    const text = result.stdout.trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

export async function readClaudeAccessToken(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  lookup: ClaudeAuthLookup = {},
): Promise<string | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("claude-read-credentials")
  }
  const readKeychain = lookup.readKeychain ?? defaultReadKeychain
  const keychainRaw = await readKeychain(CLAUDE_KEYCHAIN_SERVICE, signal)
  if (signal.aborted) {
    throw new OperationCancelledError("claude-read-credentials")
  }
  if (keychainRaw !== null) {
    const token = tokenFromKeychainRaw(keychainRaw)
    if (token !== null) {
      return token
    }
  }
  const configDir = env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude")
  const credentialPath = join(configDir, ".credentials.json")
  try {
    const text = await readFile(credentialPath, "utf8")
    if (signal.aborted) {
      throw new OperationCancelledError("claude-read-credentials")
    }
    const parsed: unknown = JSON.parse(text)
    return accessTokenFromUnknown(parsed)
  } catch (error: unknown) {
    if (error instanceof OperationCancelledError) {
      throw error
    }
    return null
  }
}
