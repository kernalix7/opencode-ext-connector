import { homedir } from "node:os"
import { join } from "node:path"

import type { ClaudeCredentials } from "./credentials"

export function opencodeAuthJsonPaths(
  env: Readonly<Record<string, string | undefined>>,
  platform: string = process.platform,
): readonly string[] {
  const home = homedir()
  const dataHome = env["XDG_DATA_HOME"]
  const paths = [join(home, ".local", "share", "opencode", "auth.json")]
  if (dataHome !== undefined && dataHome.length > 0) {
    paths.unshift(join(dataHome, "opencode", "auth.json"))
  }
  if (platform === "win32") {
    const local = env["LOCALAPPDATA"] ?? join(home, "AppData", "Local")
    paths.push(join(local, "opencode", "auth.json"))
  }
  return paths
}

export function mergeOpencodeAuthJson(existing: unknown, credentials: ClaudeCredentials): string {
  const root =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...existing }
      : {}
  return `${JSON.stringify(
    {
      ...root,
      anthropic: {
        type: "oauth",
        access: credentials.accessToken,
        refresh: credentials.refreshToken,
        expires: credentials.expiresAtMs,
      },
    },
    null,
    2,
  )}\n`
}
