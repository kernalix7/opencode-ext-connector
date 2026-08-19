import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { mergeOpencodeAuthJson, opencodeAuthJsonPaths } from "./auth-json"
import type { ClaudeCredentials } from "./credentials"
import { parseKeychainAccount } from "./keychain-account"

const execFileAsync = promisify(execFile)
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials"
const CLAUDE_KEYCHAIN_ACCOUNT = "Claude Code"

export type ClaudeWriteBackHooks = {
  readonly writeFile?: (path: string, body: string) => Promise<void>
  readonly readFile?: (path: string) => Promise<string | null>
  readonly writeKeychain?: (args: readonly string[]) => Promise<void>
  readonly readKeychainDump?: () => Promise<string | null>
  readonly platform?: string
}

export function claudeCredentialPath(env: Readonly<Record<string, string | undefined>>): string {
  const configDir = env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude")
  return join(configDir, ".credentials.json")
}

export function claudeWindowsCredentialPaths(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const appdata = env["APPDATA"]
  if (appdata === undefined || appdata.length === 0) {
    return []
  }
  return [join(appdata, "Claude", ".credentials.json")]
}

export function claudeCredentialsFileBody(credentials: ClaudeCredentials): string {
  return `${JSON.stringify(
    {
      claudeAiOauth: {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAtMs,
      },
    },
    null,
    2,
  )}\n`
}

export function claudeKeychainWriteArgs(
  credentials: ClaudeCredentials,
  account = CLAUDE_KEYCHAIN_ACCOUNT,
): readonly string[] {
  return [
    "add-generic-password",
    "-U",
    "-s",
    CLAUDE_KEYCHAIN_SERVICE,
    "-a",
    account,
    "-w",
    claudeCredentialsFileBody(credentials).trim(),
  ]
}

async function defaultReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function defaultWriteFile(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body, { encoding: "utf8", mode: 0o600 })
}

async function defaultWriteKeychain(args: readonly string[]): Promise<void> {
  await execFileAsync("security", [...args], { timeout: 2_000 })
}

async function defaultReadKeychainDump(): Promise<string | null> {
  try {
    const result = await execFileAsync(
      "security",
      ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE],
      { timeout: 2_000 },
    )
    return result.stdout
  } catch {
    return null
  }
}

export async function resolveKeychainAccount(
  readDump: () => Promise<string | null> = defaultReadKeychainDump,
): Promise<string> {
  const dump = await readDump()
  if (dump === null) {
    return CLAUDE_KEYCHAIN_ACCOUNT
  }
  return parseKeychainAccount(dump) ?? CLAUDE_KEYCHAIN_ACCOUNT
}

export async function writeClaudeCredentials(
  env: Readonly<Record<string, string | undefined>>,
  credentials: ClaudeCredentials,
  hooks: ClaudeWriteBackHooks = {},
): Promise<void> {
  const write = hooks.writeFile ?? defaultWriteFile
  const body = claudeCredentialsFileBody(credentials)
  const paths = [claudeCredentialPath(env)]
  const platform = hooks.platform ?? process.platform
  if (platform === "win32") {
    paths.push(...claudeWindowsCredentialPaths(env))
  }
  for (const path of paths) {
    await write(path, body)
  }
  const readExisting = hooks.readFile ?? defaultReadFile
  for (const path of opencodeAuthJsonPaths(env, platform)) {
    const raw = await readExisting(path)
    let existing: unknown = {}
    if (raw !== null) {
      try {
        existing = JSON.parse(raw)
      } catch {
        existing = {}
      }
    }
    await write(path, mergeOpencodeAuthJson(existing, credentials))
  }
  if (platform === "darwin") {
    const writeKeychain = hooks.writeKeychain ?? defaultWriteKeychain
    const account = await resolveKeychainAccount(hooks.readKeychainDump ?? defaultReadKeychainDump)
    await writeKeychain(claudeKeychainWriteArgs(credentials, account))
  }
}

export async function writeClaudeCredentialsFile(
  env: Readonly<Record<string, string | undefined>>,
  credentials: ClaudeCredentials,
): Promise<void> {
  await writeClaudeCredentials(env, credentials)
}
