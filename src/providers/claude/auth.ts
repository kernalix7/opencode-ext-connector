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
import { refreshClaudeAccessTokenResult } from "./refresh"

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

function keychainFailure(error: unknown): Error | null {
  if (typeof error !== "object" || error === null) {
    return new Error("Failed to read Claude Code credentials from macOS Keychain.", {
      cause: error,
    })
  }
  const status = "status" in error ? error.status : undefined
  const code = "code" in error ? error.code : undefined
  const killed = "killed" in error ? error.killed : undefined
  if (killed === true || code === "ETIMEDOUT") {
    return new Error("Claude Code Keychain read timed out.", { cause: error })
  }
  if (status === 36) {
    return new Error("macOS Keychain is locked.", { cause: error })
  }
  if (status === 128) {
    return new Error("macOS Keychain access was denied.", { cause: error })
  }
  return status === 44
    ? null
    : new Error("Failed to read Claude Code credentials.", { cause: error })
}

async function defaultReadKeychain(service: string, signal: AbortSignal): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null
  }
  try {
    const result = await execFileAsync("security", ["find-generic-password", "-s", service, "-w"], {
      timeout: 2_000,
      signal,
    })
    const text = result.stdout.trim()
    return text.length > 0 ? text : null
  } catch (error) {
    const failure = keychainFailure(error)
    if (failure !== null) {
      throw failure
    }
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

type ClaudeTokenOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly clock: Clock
  readonly transport: HttpTransport
  readonly lookup?: ClaudeAuthLookup
  readonly writeBack?: (credentials: ClaudeCredentials) => Promise<void>
}

export type ClaudeTokenManager = {
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
}

export function createClaudeTokenManager(options: ClaudeTokenOptions): ClaudeTokenManager {
  let cached: ClaudeCredentials | null = null
  let lastStored: ClaudeCredentials | null = null
  let refreshing: Promise<string | null> | null = null
  let refreshRetryAtMs = 0
  let consecutiveRefreshFailures = 0
  const persist = async (credentials: ClaudeCredentials): Promise<void> => {
    cached = credentials
    if (options.writeBack !== undefined) {
      await options.writeBack(credentials)
    }
  }
  const readSource = async (signal: AbortSignal): Promise<ClaudeCredentials | null> => {
    const latest = await readClaudeCredentials(options.env, signal, options.lookup ?? {})
    if (
      latest !== null &&
      (lastStored === null ||
        latest.accessToken !== lastStored.accessToken ||
        latest.refreshToken !== lastStored.refreshToken ||
        latest.expiresAtMs !== lastStored.expiresAtMs)
    ) {
      lastStored = latest
      cached = latest
    }
    return cached
  }
  const refresh = async (
    credentials: ClaudeCredentials,
    signal: AbortSignal,
  ): Promise<string | null> => {
    if (credentials.refreshToken === null) {
      return credentials.accessToken
    }
    if (options.clock.nowMs() < refreshRetryAtMs) {
      return null
    }
    if (refreshing !== null) {
      return refreshing
    }
    const operation = (async (): Promise<string | null> => {
      const result = await refreshClaudeAccessTokenResult({
        transport: options.transport,
        clock: options.clock,
        refreshToken: credentials.refreshToken ?? "",
        signal,
      })
      if (!result.ok) {
        if (result.kind === "transient") {
          consecutiveRefreshFailures += 1
          const scheduled = Math.min(
            60_000,
            15_000 * 2 ** Math.max(0, consecutiveRefreshFailures - 1),
          )
          refreshRetryAtMs =
            options.clock.nowMs() + Math.min(60_000, result.retryAfterMs ?? scheduled)
        } else {
          consecutiveRefreshFailures = 0
          refreshRetryAtMs = 0
        }
        return null
      }
      const refreshed = result.credentials
      consecutiveRefreshFailures = 0
      refreshRetryAtMs = 0
      await persist(refreshed)
      return refreshed.accessToken
    })()
    refreshing = operation
    try {
      return await operation
    } finally {
      if (refreshing === operation) {
        refreshing = null
      }
    }
  }
  const readAccessToken = async (signal: AbortSignal): Promise<string | null> => {
    const source = await readSource(signal)
    if (source === null) {
      return null
    }
    if (!claudeAccessNeedsRefresh(source, options.clock.nowMs()) || source.refreshToken === null) {
      return source.accessToken
    }
    const refreshedToken = await refresh(source, signal)
    if (refreshedToken === null) {
      return source.accessToken
    }
    return refreshedToken
  }
  const forceRefreshAccessToken = async (signal: AbortSignal): Promise<string | null> => {
    const source = await readSource(signal)
    if (source === null) {
      return null
    }
    return refresh(source, signal)
  }
  return { readAccessToken, forceRefreshAccessToken }
}

export function createClaudeTokenReader(
  options: ClaudeTokenOptions,
): (signal: AbortSignal) => Promise<string | null> {
  const manager = createClaudeTokenManager(options)
  return manager.readAccessToken
}
