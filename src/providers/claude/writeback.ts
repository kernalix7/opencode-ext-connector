import { writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import type { ClaudeCredentials } from "./credentials"

export function claudeCredentialPath(env: Readonly<Record<string, string | undefined>>): string {
  const configDir = env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude")
  return join(configDir, ".credentials.json")
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

export async function writeClaudeCredentialsFile(
  env: Readonly<Record<string, string | undefined>>,
  credentials: ClaudeCredentials,
): Promise<void> {
  await writeFile(claudeCredentialPath(env), claudeCredentialsFileBody(credentials), {
    encoding: "utf8",
    mode: 0o600,
  })
}
