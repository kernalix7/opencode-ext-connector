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
  const commandCode = Reflect.get(value, "commandcode")
  if (typeof commandCode === "string" && commandCode.length > 0) {
    return commandCode
  }
  if (typeof commandCode === "object" && commandCode !== null) {
    const type = Reflect.get(commandCode, "type")
    const access = Reflect.get(commandCode, "access")
    if (type === "oauth" && typeof access === "string" && access.length > 0) {
      return access
    }
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
