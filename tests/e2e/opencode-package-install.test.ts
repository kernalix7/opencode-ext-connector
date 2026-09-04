import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createOpencodeClient } from "@opencode-ai/sdk"
import { z } from "zod"

import { type OpenCodeProcess, startOpenCode } from "../support/opencode-process"
import { packCleanSource } from "../support/packed-package"

const projectRoot = join(import.meta.dir, "..", "..")
const rootExportsSchema = z.object({
  names: z.array(z.string()),
  kinds: z.array(z.string()),
})

type PackageCommand = {
  readonly operation: "extract" | "inspect-exports"
  readonly command: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

class PackageE2eCommandError extends Error {
  public override readonly name = "PackageE2eCommandError"

  public constructor(
    public readonly operation: PackageCommand["operation"],
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`${operation} failed with code ${exitCode}: ${stderr.trim()}`)
  }
}

function isolatedEnvironment(home: string, registryUrl: string): Readonly<Record<string, string>> {
  return {
    BUN_CONFIG_REGISTRY: registryUrl,
    HOME: home,
    NPM_CONFIG_CACHE: join(home, "npm-cache"),
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_REGISTRY: registryUrl,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
  }
}

async function runPackageCommand(packageCommand: PackageCommand): Promise<string> {
  const child = Bun.spawn([...packageCommand.command], {
    cwd: packageCommand.cwd,
    env: { ...packageCommand.env },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new PackageE2eCommandError(packageCommand.operation, exitCode, stderr)
  }
  return stdout
}

describe("packed package installation", () => {
  it("loads the package and lists providers with stored custom-provider markers", async () => {
    // Given
    const requests: string[] = []
    const registry = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(request.url)
        return new Response("registry access is forbidden", { status: 502 })
      },
    })
    const directory = await mkdtemp(join(tmpdir(), "opencode-package-install-"))
    const home = join(directory, "home")
    const registryUrl = `http://${registry.hostname}:${registry.port}`
    const env = isolatedEnvironment(home, registryUrl)
    const binary = process.env["OPENCODE_BIN"] ?? "opencode"
    const cacheProjectRoot = join(
      env["XDG_CACHE_HOME"] ?? "",
      "opencode",
      "packages",
      "opencode-ext-connector@0.2.0",
    )
    const cacheNodeModules = join(cacheProjectRoot, "node_modules")
    const packageDirectory = join(cacheNodeModules, "opencode-ext-connector")
    let opencode: OpenCodeProcess | undefined
    let packed: Awaited<ReturnType<typeof packCleanSource>> | undefined
    try {
      const authDirectory = join(home, "data", "opencode")
      await mkdir(authDirectory, { recursive: true })
      await writeFile(
        join(authDirectory, "auth.json"),
        JSON.stringify({
          cursor: { type: "api", key: "cli-session:cursor" },
          "command-code": { type: "api", key: "cli-session:command-code" },
        }),
        "utf8",
      )
      packed = await packCleanSource({ projectRoot })
      const workspaceNodeModules = join(projectRoot, "node_modules")
      const dependencyEntries = await readdir(workspaceNodeModules)
      expect(dependencyEntries).not.toContain("opencode-ext-connector")
      await mkdir(cacheNodeModules, { recursive: true })
      await Promise.all(
        dependencyEntries.map((entry) =>
          symlink(join(workspaceNodeModules, entry), join(cacheNodeModules, entry)),
        ),
      )
      await mkdir(packageDirectory)
      await runPackageCommand({
        operation: "extract",
        command: [
          "tar",
          "-xzf",
          packed.tarballPath,
          "--strip-components=1",
          "-C",
          packageDirectory,
        ],
        cwd: cacheProjectRoot,
        env,
      })
      await writeFile(
        join(directory, "opencode.json"),
        JSON.stringify({
          autoupdate: false,
          plugin: [pathToFileURL(join(packageDirectory, "dist", "index.js")).href],
          share: "disabled",
        }),
        "utf8",
      )

      // When
      const rawExports = await runPackageCommand({
        operation: "inspect-exports",
        command: [
          process.execPath,
          "--eval",
          'const root = await import("opencode-ext-connector"); const names = Object.keys(root).sort(); process.stdout.write(JSON.stringify({ names, kinds: names.map((name) => typeof root[name]) }))',
        ],
        cwd: cacheProjectRoot,
        env,
      })
      opencode = await startOpenCode({ binary, cwd: directory, env })
      const auth = await createOpencodeClient({ baseUrl: opencode.url }).provider.auth()
      const providers = await createOpencodeClient({ baseUrl: opencode.url }).provider.list()

      // Then
      expect(rootExportsSchema.parse(JSON.parse(rawExports))).toEqual({
        names: [
          "claudeAuthServer",
          "commandCodeAuthServer",
          "connectorServer",
          "cursorAuthServer",
          "ollamaAuthServer",
        ],
        kinds: ["function", "function", "function", "function", "function"],
      })
      expect(Object.keys(auth.data ?? {}).sort()).toEqual([
        "anthropic",
        "command-code",
        "cursor",
        "ollama",
      ])
      expect(providers.data).toBeDefined()
      expect(providers.data?.connected).not.toContain("cursor")
      expect(providers.data?.connected).not.toContain("command-code")
      expect(requests).toEqual([])
    } finally {
      await opencode?.close()
      await packed?.cleanup()
      await registry.stop(true)
      await rm(directory, { force: true, recursive: true })
    }
  }, 60_000)
})
