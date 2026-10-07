import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { opencodeAuthJsonPaths } from "../../opencode/auth-store.js"
import { writeClaudePrivateFile } from "./atomic-private-file.js"
import { mergeOpencodeAuthJson } from "./auth-json.js"
import type { ClaudeCredentials } from "./credentials.js"
import { parseKeychainAccount } from "./keychain-account.js"

const exec = promisify(execFile)
type KeychainCommand = (
  args: readonly string[],
) => Promise<{ readonly stdout: string; readonly stderr: string }>
const defaultKeychainCommand: KeychainCommand = (args) =>
  exec("security", [...args], { timeout: 2_000 })
export function createClaudeKeychainReaders(command: KeychainCommand = defaultKeychainCommand): {
  readonly readKeychainValue: () => Promise<string | null>
  readonly readKeychainDump: () => Promise<string | null>
} {
  const read = async (args: readonly string[]): Promise<string | null> => {
    try {
      const output = await command(args)
      const value = args.includes("-w")
        ? output.stdout.trim()
        : `${output.stdout}\n${output.stderr}`
      return value.trim() || null
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && Reflect.get(error, "code") === 44)
        return null
      throw error
    }
  }
  return {
    readKeychainValue: () => read(["find-generic-password", "-s", "Claude Code-credentials", "-w"]),
    readKeychainDump: () => read(["find-generic-password", "-s", "Claude Code-credentials", "-g"]),
  }
}
export type ClaudeWriteBackHooks = {
  readonly enabled: boolean
  readonly source: "file" | "keychain"
  readonly expectedPriorAccessToken: string
  readonly writeFile?: (path: string, body: string) => Promise<void>
  readonly readFile?: (path: string) => Promise<string | null>
  readonly writeKeychain?: (args: readonly string[]) => Promise<void>
  readonly readKeychainDump?: () => Promise<string | null>
  readonly readKeychainValue?: () => Promise<string | null>
  readonly platform?: string
}
export function claudeCredentialPath(env: Readonly<Record<string, string | undefined>>): string {
  return join(env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude"), ".credentials.json")
}
export function claudeWindowsCredentialPaths(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  return env["APPDATA"] ? [join(env["APPDATA"], "Claude", ".credentials.json")] : []
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
export function updateClaudeCredentialBlob(
  raw: string,
  credentials: ClaudeCredentials,
  expectedPriorAccessToken: string,
): string | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return null
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const wrapped = "claudeAiOauth" in value ? Reflect.get(value, "claudeAiOauth") : value
  if (
    typeof wrapped !== "object" ||
    wrapped === null ||
    Array.isArray(wrapped) ||
    Reflect.get(wrapped, "accessToken") !== expectedPriorAccessToken
  )
    return null
  Reflect.set(wrapped, "accessToken", credentials.accessToken)
  Reflect.set(wrapped, "refreshToken", credentials.refreshToken)
  Reflect.set(wrapped, "expiresAt", credentials.expiresAtMs)
  return `${JSON.stringify(value, null, 2)}\n`
}
export function claudeKeychainWriteArgs(
  credentials: ClaudeCredentials,
  account: string = "Claude Code",
  body: string = claudeCredentialsFileBody(credentials).trim(),
): readonly string[] {
  return ["add-generic-password", "-U", "-s", "Claude Code-credentials", "-a", account, "-w", body]
}
async function defaultRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && Reflect.get(error, "code") === "ENOENT")
      return null
    throw error
  }
}
export async function resolveKeychainAccount(
  readDump: () => Promise<string | null>,
): Promise<string> {
  return parseKeychainAccount((await readDump()) ?? "") ?? "Claude Code"
}
export async function writeClaudeCredentials(
  env: Readonly<Record<string, string | undefined>>,
  credentials: ClaudeCredentials,
  hooks: ClaudeWriteBackHooks,
): Promise<boolean> {
  if (!hooks.enabled) return false
  const platform = hooks.platform ?? process.platform
  const read = hooks.readFile ?? defaultRead
  const write = hooks.writeFile ?? writeClaudePrivateFile
  if (hooks.source === "file") {
    const paths = [
      claudeCredentialPath(env),
      ...(platform === "win32" ? claudeWindowsCredentialPaths(env) : []),
    ]
    const updates: { readonly path: string; readonly body: string }[] = []
    for (const path of paths) {
      const raw = await read(path)
      if (raw === null) continue
      const body = updateClaudeCredentialBlob(raw, credentials, hooks.expectedPriorAccessToken)
      if (body === null) return false
      updates.push({ path, body })
    }
    if (updates.length === 0) return false
    for (const update of updates) await write(update.path, update.body)
  } else {
    if (platform !== "darwin") return false
    const readers = createClaudeKeychainReaders()
    const currentValue = await (hooks.readKeychainValue ?? readers.readKeychainValue)()
    if (currentValue === null) return false
    const updated = updateClaudeCredentialBlob(
      currentValue,
      credentials,
      hooks.expectedPriorAccessToken,
    )
    if (updated === null) return false
    const dump = await (hooks.readKeychainDump ?? readers.readKeychainDump)()
    if (dump === null) return false
    const writer =
      hooks.writeKeychain ??
      (async (args: readonly string[]) => {
        await exec("security", [...args], { timeout: 2_000 })
      })
    await writer(
      claudeKeychainWriteArgs(
        credentials,
        await resolveKeychainAccount(async () => dump),
        updated.trim(),
      ),
    )
  }
  for (const path of opencodeAuthJsonPaths(env, platform)) {
    const raw = await read(path)
    if (raw === null) continue
    let existing: unknown
    try {
      existing = JSON.parse(raw)
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error
      continue
    }
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) continue
    const anthropic = "anthropic" in existing ? Reflect.get(existing, "anthropic") : null
    if (
      typeof anthropic !== "object" ||
      anthropic === null ||
      Reflect.get(anthropic, "access") !== hooks.expectedPriorAccessToken
    )
      continue
    await write(path, mergeOpencodeAuthJson(existing, credentials))
  }
  return true
}
export async function writeClaudeCredentialsFile(
  env: Readonly<Record<string, string | undefined>>,
  credentials: ClaudeCredentials,
  hooks: ClaudeWriteBackHooks,
): Promise<boolean> {
  return writeClaudeCredentials(env, credentials, hooks)
}
