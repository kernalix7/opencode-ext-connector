import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { OperationCancelledError } from "../../core/errors.js"
import { type ClaudeCredentials, parseClaudeCredentials } from "./credentials.js"

const execFileAsync = promisify(execFile)
const keychainService = "Claude Code-credentials"

export type ClaudeAuthLookup = {
  readonly readKeychain?: (service: string, signal: AbortSignal) => Promise<string | null>
  readonly readFile?: (path: string, signal: AbortSignal) => Promise<string>
}

export type ClaudeSourceObservation = {
  readonly credentials: ClaudeCredentials
  readonly sourceIdentity: string
  readonly revision: string
}

export class ClaudeCredentialLookupError extends Error {
  public override readonly name = "ClaudeCredentialLookupError"

  public constructor(readonly kind: "locked" | "denied" | "timeout" | "failed") {
    super(`Claude credential lookup failed: ${kind}`)
  }
}

function credentialsFromRaw(raw: string): ClaudeCredentials | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null
    throw error
  }
  return parseClaudeCredentials(value)
}

async function defaultReadKeychain(service: string, signal: AbortSignal): Promise<string | null> {
  if (process.platform !== "darwin") return null
  try {
    const result = await execFileAsync("security", ["find-generic-password", "-s", service, "-w"], {
      timeout: 2_000,
      signal,
    })
    const text = result.stdout.trim()
    return text.length > 0 ? text : null
  } catch (error: unknown) {
    if (signal.aborted) throw new OperationCancelledError("claude-read-credentials")
    if (!(error instanceof Error)) throw error
    const code = "code" in error ? Reflect.get(error, "code") : undefined
    const status =
      typeof code === "number" ? code : "status" in error ? Reflect.get(error, "status") : undefined
    if (status === 44) return null
    if (status === 36) throw new ClaudeCredentialLookupError("locked")
    if (status === 128) throw new ClaudeCredentialLookupError("denied")
    if (code === "ETIMEDOUT" || ("killed" in error && Reflect.get(error, "killed") === true)) {
      throw new ClaudeCredentialLookupError("timeout")
    }
    if (code !== undefined || status !== undefined) throw new ClaudeCredentialLookupError("failed")
    throw error
  }
}

export async function readClaudeCredentials(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  lookup: ClaudeAuthLookup = {},
): Promise<ClaudeCredentials | null> {
  return (await readClaudeCredentialSource(env, signal, lookup))?.credentials ?? null
}

export async function readClaudeCredentialSource(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  lookup: ClaudeAuthLookup = {},
): Promise<ClaudeSourceObservation | null> {
  if (signal.aborted) throw new OperationCancelledError("claude-read-credentials")
  const readKeychain = lookup.readKeychain ?? defaultReadKeychain
  const keychainRaw = await readKeychain(keychainService, signal)
  if (signal.aborted) throw new OperationCancelledError("claude-read-credentials")
  if (keychainRaw !== null) {
    const credentials = credentialsFromRaw(keychainRaw)
    if (credentials !== null)
      return {
        credentials,
        sourceIdentity: "keychain:Claude Code-credentials",
        revision: createHash("sha256").update(keychainRaw).digest("hex"),
      }
  }
  const configDir = env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude")
  const read =
    lookup.readFile ??
    ((path, abortSignal) => readFile(path, { encoding: "utf8", signal: abortSignal }))
  let raw: string
  try {
    raw = await read(join(configDir, ".credentials.json"), signal)
  } catch (error: unknown) {
    if (signal.aborted) throw new OperationCancelledError("claude-read-credentials")
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EISDIR"].some(
        (code) => code === Reflect.get(error, "code"),
      )
    )
      return null
    throw error
  }
  if (signal.aborted) throw new OperationCancelledError("claude-read-credentials")
  const credentials = credentialsFromRaw(raw)
  return credentials === null
    ? null
    : {
        credentials,
        sourceIdentity: join(configDir, ".credentials.json"),
        revision: createHash("sha256").update(raw).digest("hex"),
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

export type {
  ClaudeCredentialObservation,
  ClaudeTokenManager,
  ClaudeTokenOptions,
} from "./token-manager.js"
export { createClaudeTokenManager, createClaudeTokenReader } from "./token-manager.js"
