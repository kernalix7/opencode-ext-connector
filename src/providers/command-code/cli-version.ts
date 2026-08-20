import { spawnSync } from "node:child_process"

export function parseCommandCodeCliVersion(stdout: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(stdout)
  return match?.[1] ?? null
}

export function readCommandCodeCliVersion(): string | null {
  const result = spawnSync("command-code", ["--version"], {
    encoding: "utf8",
    timeout: 3_000,
  })
  if (result.error !== undefined || result.status !== 0) {
    return null
  }
  return parseCommandCodeCliVersion(result.stdout)
}
