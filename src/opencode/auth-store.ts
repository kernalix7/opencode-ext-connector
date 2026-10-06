import { readFile as readAuthFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

const authRootSchema = z.record(z.string(), z.unknown())
const apiRecordSchema = z
  .object({
    type: z.literal("api"),
    key: z.string().min(1),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export type OpenCodeAuthProvider = "claude" | "command-code" | "ollama"

export type OpenCodeAuthMatch =
  | { readonly kind: "marker"; readonly connectionId?: string }
  | { readonly kind: "api-key"; readonly key: string; readonly connectionId?: string }

export type OpenCodeAuthStore = {
  readonly matchAuth: (provider: OpenCodeAuthProvider) => Promise<OpenCodeAuthMatch | null>
}

export type OpenCodeAuthStoreOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly platform?: string
  readonly readFile?: (path: string) => Promise<string>
}

export function opencodeAuthJsonPaths(
  env: Readonly<Record<string, string | undefined>>,
  platform: string = process.platform,
): readonly string[] {
  const home = env["HOME"] ?? homedir()
  const dataHome = env["XDG_DATA_HOME"]
  if (dataHome !== undefined && dataHome.length > 0) {
    return [join(dataHome, "opencode", "auth.json")]
  }
  const paths: string[] = []
  if (platform === "darwin") {
    paths.push(join(home, "Library", "Application Support", "opencode", "auth.json"))
  } else if (platform === "win32") {
    paths.push(join(env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"), "opencode", "auth.json"))
  } else {
    paths.push(join(home, ".local", "share", "opencode", "auth.json"))
  }
  return [...new Set(paths)]
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && Reflect.get(error, "code") === "ENOENT"
}

function parseAuthMatch(provider: OpenCodeAuthProvider, value: unknown): OpenCodeAuthMatch | null {
  switch (provider) {
    case "claude":
    case "command-code": {
      const parsed = apiRecordSchema.safeParse(value)
      return parsed.success && !parsed.data.key.startsWith("cli-session:")
        ? { kind: "api-key", key: parsed.data.key }
        : null
    }
    case "ollama": {
      const parsed = apiRecordSchema.safeParse(value)
      return parsed.success && parsed.data.key === "cli-session:ollama" ? { kind: "marker" } : null
    }
  }
}

export function createOpenCodeAuthStore(options: OpenCodeAuthStoreOptions): OpenCodeAuthStore {
  const readFile = options.readFile ?? ((path: string) => readAuthFile(path, "utf8"))
  const paths = opencodeAuthJsonPaths(options.env, options.platform)
  return {
    matchAuth: async (provider): Promise<OpenCodeAuthMatch | null> => {
      for (const path of paths) {
        let raw: string
        try {
          raw = await readFile(path)
        } catch (error: unknown) {
          if (isMissingFile(error)) {
            continue
          }
          throw error
        }
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(raw)
        } catch (error: unknown) {
          if (error instanceof SyntaxError) {
            continue
          }
          throw error
        }
        const root = authRootSchema.safeParse(parsedJson)
        if (root.success) {
          const match = parseAuthMatch(provider, root.data[provider])
          if (match !== null) {
            return match
          }
        }
      }
      return null
    },
  }
}
