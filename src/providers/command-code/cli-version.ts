import { spawnSync } from "node:child_process"
import type { HttpTransport } from "../../core/http.js"
import { createPackageVersionResolver } from "../../http/package-version.js"

export type CommandCodeVersionResolver = (signal: AbortSignal) => Promise<string | null>
export type CommandCodeVersionResolverOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly transport: HttpTransport
  readonly readInstalledVersion?: () => string | null
}

export function parseCommandCodeCliVersion(stdout: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
}

export function readInstalledCommandCodeVersion(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const result = spawnSync("command-code", ["--version"], {
    encoding: "utf8",
    timeout: 3_000,
    env: { ...env },
  })
  return result.error !== undefined || result.status !== 0
    ? null
    : parseCommandCodeCliVersion(result.stdout)
}

export function createCommandCodeVersionResolver(
  options: CommandCodeVersionResolverOptions,
): CommandCodeVersionResolver {
  const readInstalled =
    options.readInstalledVersion ?? (() => readInstalledCommandCodeVersion(options.env))
  const readPublished = createPackageVersionResolver({
    transport: options.transport,
    packageName: "command-code",
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
