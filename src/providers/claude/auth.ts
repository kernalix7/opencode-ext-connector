import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import type { Clock } from "../../core/clock"
import { OperationCancelledError } from "../../core/errors"
import type { HttpTransport } from "../../core/http"
import {
  type ClaudeCredentials,
  claudeAccessNeedsRefresh,
  parseClaudeCredentials,
} from "./credentials"
import { refreshClaudeAccessToken } from "./refresh"

const execFileAsync = promisify(execFile)
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials"

export type ClaudeAuthLookup = {
  readonly readKeychain?: (service: string, signal: AbortSignal) => Promise<string | null>
}

function credentialsFromRaw(raw: string): ClaudeCredentials | null {
  try {
    return parseClaudeCredentials(JSON.parse(raw))
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
  const credentials = await readClaudeCredentials(env, signal, lookup)
  return credentials?.accessToken ?? null
}

export async function readClaudeCredentials(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  lookup: ClaudeAuthLookup = {},
): Promise<ClaudeCredentials | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("claude-read-credentials")
  }
  const readKeychain = lookup.readKeychain ?? defaultReadKeychain
  const keychainRaw = await readKeychain(CLAUDE_KEYCHAIN_SERVICE, signal)
  if (signal.aborted) {
    throw new OperationCancelledError("claude-read-credentials")
  }
  if (keychainRaw !== null) {
    const fromKeychain = credentialsFromRaw(keychainRaw)
    if (fromKeychain !== null) {
      return fromKeychain
    }
  }
  const configDir = env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude")
  const credentialPath = join(configDir, ".credentials.json")
  try {
    const text = await readFile(credentialPath, "utf8")
    if (signal.aborted) {
      throw new OperationCancelledError("claude-read-credentials")
    }
    return parseClaudeCredentials(JSON.parse(text))
  } catch (error: unknown) {
    if (error instanceof OperationCancelledError) {
      throw error
    }
    return null
  }
}

export function createClaudeTokenReader(options: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly clock: Clock
  readonly transport: HttpTransport
  readonly lookup?: ClaudeAuthLookup
}): (signal: AbortSignal) => Promise<string | null> {
  let cached: ClaudeCredentials | null = null
  return async (signal: AbortSignal): Promise<string | null> => {
    if (cached === null) {
      cached = await readClaudeCredentials(options.env, signal, options.lookup ?? {})
    }
    if (cached === null) {
      return null
    }
    if (!claudeAccessNeedsRefresh(cached, options.clock.nowMs()) || cached.refreshToken === null) {
      return cached.accessToken
    }
    const refreshed = await refreshClaudeAccessToken({
      transport: options.transport,
      clock: options.clock,
      refreshToken: cached.refreshToken,
      signal,
    })
    if (refreshed === null) {
      return cached.accessToken
    }
    cached = refreshed
    return cached.accessToken
  }
}
