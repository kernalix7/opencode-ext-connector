import { spawnSync } from "node:child_process"

import type { HttpTransport } from "../../core/http"
import { createPackageVersionResolver } from "../../http/package-version"

const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code"

export type ClaudeVersionResolver = (signal: AbortSignal) => Promise<string | null>

export type ClaudeVersionResolverOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly transport: HttpTransport
  readonly readInstalledVersion?: () => string | null
}

export function parseClaudeCliVersion(stdout: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(stdout)
  return match?.[1] ?? null
}

export function readInstalledClaudeVersion(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
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

export function createClaudeVersionResolver(
  options: ClaudeVersionResolverOptions,
): ClaudeVersionResolver {
  const readInstalled =
    options.readInstalledVersion ?? (() => readInstalledClaudeVersion(options.env))
  const readPublished = createPackageVersionResolver({
    transport: options.transport,
    packageName: CLAUDE_CODE_PACKAGE,
  })
  let local: string | null | undefined
  return async (signal) => {
    if (local === undefined) {
      const override = options.env["ANTHROPIC_CLI_VERSION"]?.trim()
      local =
        override !== undefined && override.length > 0
          ? parseClaudeCliVersion(override)
          : readInstalled()
    }
    return local ?? readPublished(signal)
  }
}
