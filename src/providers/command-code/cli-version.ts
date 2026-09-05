import { spawnSync } from "node:child_process"

import type { HttpTransport } from "../../core/http"
import { createPackageVersionResolver } from "../../http/package-version"

const COMMAND_CODE_PACKAGE = "command-code"

export type CommandCodeVersionResolver = (signal: AbortSignal) => Promise<string | null>

export type CommandCodeVersionResolverOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly transport: HttpTransport
  readonly readInstalledVersion?: () => string | null
}

export function parseCommandCodeCliVersion(stdout: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(stdout)
  return match?.[1] ?? null
}

export function readInstalledCommandCodeVersion(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const result = spawnSync("command-code", ["--version"], {
    encoding: "utf8",
    timeout: 3_000,
    env: { ...env },
  })
  if (result.error !== undefined || result.status !== 0) {
    return null
  }
  return parseCommandCodeCliVersion(result.stdout)
}

export function createCommandCodeVersionResolver(
  options: CommandCodeVersionResolverOptions,
): CommandCodeVersionResolver {
  const readInstalled =
    options.readInstalledVersion ?? (() => readInstalledCommandCodeVersion(options.env))
  const readPublished = createPackageVersionResolver({
    transport: options.transport,
    packageName: COMMAND_CODE_PACKAGE,
  })
  let local: string | null | undefined
  return async (signal) => {
    if (local === undefined) {
      const override = options.env["COMMAND_CODE_CLI_VERSION"]?.trim()
      local =
        override !== undefined && override.length > 0
          ? parseCommandCodeCliVersion(override)
          : readInstalled()
    }
    return local ?? readPublished(signal)
  }
}
