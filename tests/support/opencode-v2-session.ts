import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type OpenCodeV2Process, startOpenCodeV2 } from "./opencode-v2-process"

export const OPENCODE_V2_BIN_ENV = "OPENCODE_V2_BIN"

const blockedHostKeys = [
  "ALL_PROXY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "COMMAND_CODE_API_KEY",
  "CURSOR_ACCESS_TOKEN",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "OLLAMA_API_KEY",
  "OLLAMA_HOST",
  "OPENCODE_API_KEY",
  "OPENCODE_SERVER_PASSWORD",
] as const

export class OpenCodeV2BinaryMissingError extends Error {
  public override readonly name = "OpenCodeV2BinaryMissingError"

  public constructor() {
    super(`${OPENCODE_V2_BIN_ENV} is unset and the installed opencode2 binary is absent`)
  }
}

export class OpenCodeV2EntryMissingError extends Error {
  public override readonly name = "OpenCodeV2EntryMissingError"

  public constructor(public readonly entryPath: string) {
    super(`Packed V2 entry is missing at ${entryPath}`)
  }
}

export type OpenCodeV2Session = {
  readonly directory: string
  readonly home: string
  readonly server: OpenCodeV2Process
}

export function openCodeV2Binary(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const injected = environment[OPENCODE_V2_BIN_ENV]
  if (injected !== undefined && injected.length > 0) return injected
  return Bun.which("opencode2") ?? undefined
}

export function requireOpenCodeV2Binary(): string {
  const binary = openCodeV2Binary()
  if (binary === undefined) throw new OpenCodeV2BinaryMissingError()
  return binary
}

export function isolatedV2Environment(
  home: string,
  fixtureEnv: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return {
    HOME: home,
    NPM_CONFIG_OFFLINE: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    PATH: "/usr/bin:/bin",
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    ...fixtureEnv,
  }
}

export function blockedV2HostKeys(): readonly string[] {
  return blockedHostKeys
}

export async function runOpenCodeV2(input: {
  readonly binary: string
  readonly config: unknown
  readonly fixtureEnv?: Readonly<Record<string, string>>
  readonly run: (session: OpenCodeV2Session) => Promise<void>
}): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "opencode-v2-"))
  const home = join(root, "home")
  const directory = join(home, "config", "opencode")
  let server: OpenCodeV2Process | undefined
  try {
    await mkdir(home, { recursive: true })
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "opencode.json"), JSON.stringify(input.config), "utf8")
    server = await startOpenCodeV2({
      binary: input.binary,
      cwd: directory,
      env: isolatedV2Environment(home, input.fixtureEnv),
    })
    await input.run({ directory, home, server })
  } finally {
    await server?.close()
    await rm(root, { force: true, recursive: true })
  }
}
