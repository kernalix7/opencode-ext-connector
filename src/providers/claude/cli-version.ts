import { spawnSync } from "node:child_process"
import type { HttpTransport } from "../../core/http.js"
import { createPackageVersionResolver } from "../../http/package-version.js"

export type ClaudeVersionResolver = (signal: AbortSignal) => Promise<string | null>
export type ClaudeVersionResolverOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly transport: HttpTransport
  readonly readInstalledVersion?: () => string | null
}
export function parseClaudeCliVersion(stdout: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
}
export function readInstalledClaudeVersion(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const result = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    timeout: 3_000,
    env: { ...env },
  })
  return result.error !== undefined || result.status !== 0
    ? null
    : parseClaudeCliVersion(result.stdout)
}
export function createClaudeVersionResolver(
  options: ClaudeVersionResolverOptions,
): ClaudeVersionResolver {
  const published = createPackageVersionResolver({
    transport: options.transport,
    packageName: "@anthropic-ai/claude-code",
  })
  let local: string | null | undefined
  return async (signal) => {
    if (local === undefined) {
      const override = options.env["ANTHROPIC_CLI_VERSION"]?.trim()
      local =
        override !== undefined && override.length > 0
          ? parseClaudeCliVersion(override)
          : (options.readInstalledVersion ?? (() => readInstalledClaudeVersion(options.env)))()
    }
    return local ?? published(signal)
  }
}
