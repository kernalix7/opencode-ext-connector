import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { OperationCancelledError } from "../../core/errors"

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

type CredentialCandidate = {
  readonly path: string
  readonly allowsGenericToken: boolean
}

function tokenFromUnknown(value: unknown, allowsGenericToken: boolean): string | null {
  const parsed = credentialSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }
  if (allowsGenericToken) {
    for (const key of ["apiKey", "accessToken", "token"] as const) {
      const token = parsed.data[key]
      if (token !== undefined && token.length > 0) {
        return token
      }
    }
  }
  const commandCode = parsed.data.commandcode
  if (typeof commandCode === "string" && commandCode.length > 0) {
    return commandCode
  }
  if (typeof commandCode === "object" && commandCode.access.length > 0) {
    return commandCode.access
  }
  return null
}

export type CommandCodeAuthLookup = {
  readonly homeDir?: string
}

export function commandCodeCredentialPaths(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const xdg = env["XDG_CONFIG_HOME"]
  const paths = [
    join(homeDir, ".commandcode", "auth.json"),
    join(homeDir, ".commandcode", "cli-config.json"),
    join(homeDir, ".pi", "agent", "auth.json"),
    join(homeDir, ".config", "commandcode", "auth.json"),
    join(homeDir, ".config", "commandcode", "cli-config.json"),
    join(homeDir, ".config", "command-code", "auth.json"),
  ]
  if (xdg !== undefined && xdg.length > 0) {
    return [
      join(xdg, "commandcode", "auth.json"),
      join(xdg, "commandcode", "cli-config.json"),
      ...paths,
    ]
  }
  return paths
}

export async function readCommandCodeAccessToken(
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  lookup: CommandCodeAuthLookup = {},
): Promise<string | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("command-code-read-credentials")
  }
  const envToken = env["COMMAND_CODE_API_KEY"] ?? env["COMMANDCODE_API_KEY"] ?? env["CC_API_KEY"]
  if (envToken !== undefined && envToken.length > 0) {
    return envToken
  }
  const home = lookup.homeDir ?? env["HOME"] ?? homedir()
  const candidates = commandCodeCredentialPaths(home, env)
  const sharedPiPath = join(home, ".pi", "agent", "auth.json")
  const ownedCandidates: readonly CredentialCandidate[] = candidates.map((path) => ({
    path,
    allowsGenericToken: path !== sharedPiPath,
  }))
  for (const candidate of ownedCandidates) {
    try {
      const parsed: unknown = JSON.parse(await readFile(candidate.path, "utf8"))
      const token = tokenFromUnknown(parsed, candidate.allowsGenericToken)
      if (token !== null) {
        return token
      }
    } catch (error) {
      if (error instanceof Error) {
        continue
      }
      throw error
    }
  }
  return null
}
