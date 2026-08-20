import { spawnSync } from "node:child_process"

export function parseClaudeCliVersion(stdout: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(stdout)
  return match?.[1] ?? null
}

export function readClaudeCliVersion(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const override = env["ANTHROPIC_CLI_VERSION"]?.trim()
  if (override !== undefined && override.length > 0) {
    return parseClaudeCliVersion(override)
  }
  const result = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    timeout: 3_000,
    env: { ...env },
  })
  if (result.error !== undefined || result.status !== 0) {
    return null
  }
  return parseClaudeCliVersion(result.stdout)
}
