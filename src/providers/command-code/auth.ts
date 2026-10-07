import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { OperationCancelledError } from "../../core/errors.js"

const credentialSchema = z
  .object({
    apiKey: z.string().optional(),
    accessToken: z.string().optional(),
    token: z.string().optional(),
    commandcode: z
      .union([z.string(), z.object({ type: z.literal("oauth"), access: z.string() })])
      .optional(),
  })
  .passthrough()

export type CommandCodeAuthLookup = {
  readonly homeDir?: string
  readonly readFile?: (path: string, signal: AbortSignal) => Promise<string>
}

function tokenFromUnknown(value: unknown, allowsGenericToken: boolean): string | null {
  const parsed = credentialSchema.safeParse(value)
  if (!parsed.success) return null
  if (allowsGenericToken) {
    for (const key of ["apiKey", "accessToken", "token"] as const) {
      const token = parsed.data[key]
      if (token !== undefined && token.length > 0) return token
    }
  }
  const scoped = parsed.data.commandcode
  if (typeof scoped === "string" && scoped.length > 0) return scoped
  return typeof scoped === "object" && scoped.access.length > 0 ? scoped.access : null
}

export function commandCodeCredentialPaths(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const paths = [
    join(homeDir, ".commandcode", "auth.json"),
    join(homeDir, ".commandcode", "cli-config.json"),
    join(homeDir, ".pi", "agent", "auth.json"),
    join(homeDir, ".config", "commandcode", "auth.json"),
    join(homeDir, ".config", "commandcode", "cli-config.json"),
    join(homeDir, ".config", "command-code", "auth.json"),
  ]
  const xdg = env["XDG_CONFIG_HOME"]
  return xdg !== undefined && xdg.length > 0
    ? [join(xdg, "commandcode", "auth.json"), join(xdg, "commandcode", "cli-config.json"), ...paths]
    : paths
}

function unavailableFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EISDIR"].some(
      (code) => code === Reflect.get(error, "code"),
    )
  )
}

export type CommandCodeCredentialSource = {
  readonly accessToken: string
  readonly sourceIdentity: string
}

export async function readCommandCodeCredentialSource(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  lookup: CommandCodeAuthLookup = {},
): Promise<CommandCodeCredentialSource | null> {
  if (signal.aborted) throw new OperationCancelledError("command-code-read-credentials")
  const name =
    env["COMMAND_CODE_API_KEY"] !== undefined
      ? "COMMAND_CODE_API_KEY"
      : env["COMMANDCODE_API_KEY"] !== undefined
        ? "COMMANDCODE_API_KEY"
        : "CC_API_KEY"
  const envToken = env[name]
  if (envToken !== undefined && envToken.length > 0)
    return { accessToken: envToken, sourceIdentity: name }
  const home = lookup.homeDir ?? env["HOME"] ?? homedir()
  const sharedPiPath = join(home, ".pi", "agent", "auth.json")
  const read =
    lookup.readFile ??
    ((path, abortSignal) => readFile(path, { encoding: "utf8", signal: abortSignal }))
  for (const path of commandCodeCredentialPaths(home, env)) {
    if (signal.aborted) throw new OperationCancelledError("command-code-read-credentials")
    let raw: string
    try {
      raw = await read(path, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw new OperationCancelledError("command-code-read-credentials")
      if (unavailableFile(error)) continue
      throw error
    }
    if (signal.aborted) throw new OperationCancelledError("command-code-read-credentials")
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error: unknown) {
      if (error instanceof SyntaxError) continue
      throw error
    }
    const token = tokenFromUnknown(value, path !== sharedPiPath)
    if (token !== null) return { accessToken: token, sourceIdentity: path }
  }
  return null
}

export async function readCommandCodeAccessToken(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  lookup: CommandCodeAuthLookup = {},
): Promise<string | null> {
  return (await readCommandCodeCredentialSource(env, signal, lookup))?.accessToken ?? null
}
