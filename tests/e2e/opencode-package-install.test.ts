import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOpencodeClient } from "@opencode-ai/sdk"
import { z } from "zod"

import { type OpenCodeProcess, startOpenCode } from "../support/opencode-process"
import { runPackageCommand } from "../support/package-command"
import { packCleanSource, readPackageManifest } from "../support/packed-package"

const projectRoot = join(import.meta.dir, "..", "..")
const rootExportNames = [
  "claudeAuthServer",
  "commandCodeAuthServer",
  "connectorServer",
  "cursorAuthServer",
  "ollamaAuthServer",
  "xaiAuthServer",
] as const
const rootExportsSchema = z.object({ names: z.array(z.string()), kinds: z.array(z.string()) })

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

describe("packed package installation", () => {
  it("loads a cached npm package spec and lists providers with stored custom-provider markers", async () => {
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
    const directory = await mkdtemp(join(tmpdir(), "opencode-package-install-")),
      home = join(directory, "home")
    const env = isolatedEnvironment(home, `http://${registry.hostname}:${registry.port}`)
    const binary = process.env["OPENCODE_BIN"] ?? "opencode"
    const manifest = await readPackageManifest(projectRoot)
    const cacheProjectRoot = join(
      env["XDG_CACHE_HOME"] ?? "",
      "opencode",
      "packages",
      `${manifest.name}@${manifest.version}`,
    )
    const cacheNodeModules = join(cacheProjectRoot, "node_modules")
    const packageDirectory = join(cacheNodeModules, manifest.name)
    let opencode: OpenCodeProcess | undefined,
      packed: Awaited<ReturnType<typeof packCleanSource>> | undefined
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
      await writeFile(
        join(cacheProjectRoot, "package.json"),
        JSON.stringify({
          name: "connector-offline-consumer",
          private: true,
          type: "module",
          dependencies: { [manifest.name]: manifest.version },
        }),
      )
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
          plugin: [`${manifest.name}@${manifest.version}`],
          share: "disabled",
        }),
        "utf8",
      )

      // When
      const inspectFile = join(cacheProjectRoot, "inspect.mjs")
      await writeFile(
        inspectFile,
        'const root = await import("opencode-ext-connector"); const names = Object.keys(root).sort(); process.stdout.write(JSON.stringify({ names, kinds: names.map((name) => typeof root[name]) }))',
      )
      const rawExports = await runPackageCommand({
        operation: "inspect-exports",
        command: [process.execPath, inspectFile],
        cwd: cacheProjectRoot,
        env,
      })
      opencode = await startOpenCode({ binary, cwd: directory, env })
      const auth = await createOpencodeClient({ baseUrl: opencode.url }).provider.auth()
      const providers = await createOpencodeClient({ baseUrl: opencode.url }).provider.list()

      // Then
      expect(rootExportsSchema.parse(JSON.parse(rawExports))).toEqual({
        names: [...rootExportNames],
        kinds: ["function", "function", "function", "function", "function", "function"],
      })
      expect(Object.keys(auth.data ?? {}).sort()).toEqual(["claude", "command-code", "ollama"])
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

  it("loads every public entrypoint in real Node ESM", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-package-node-esm-")),
      home = join(directory, "home")
    const env = isolatedEnvironment(home, "http://127.0.0.1:1")
    const manifest = await readPackageManifest(projectRoot)
    const cacheProjectRoot = join(
      env["XDG_CACHE_HOME"] ?? "",
      "opencode",
      "packages",
      `${manifest.name}@${manifest.version}`,
    )
    const packageDirectory = join(cacheProjectRoot, "node_modules", manifest.name)
    let packed: Awaited<ReturnType<typeof packCleanSource>> | undefined
    try {
      packed = await packCleanSource({ projectRoot })
      const dependencyEntries = await readdir(join(projectRoot, "node_modules"))
      await mkdir(join(cacheProjectRoot, "node_modules"), { recursive: true })
      await writeFile(
        join(cacheProjectRoot, "package.json"),
        JSON.stringify({
          name: "connector-offline-consumer",
          private: true,
          type: "module",
          dependencies: { [manifest.name]: manifest.version },
        }),
      )
      await Promise.all(
        dependencyEntries.map((entry) =>
          symlink(
            join(projectRoot, "node_modules", entry),
            join(cacheProjectRoot, "node_modules", entry),
          ),
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

      // When
      const consumerFile = join(cacheProjectRoot, "consumer.mjs")
      await writeFile(
        consumerFile,
        `
        const root = await import('opencode-ext-connector');
        const claude = await import('opencode-ext-connector/claude');
        const commandCode = await import('opencode-ext-connector/command-code');
        const cursor = await import('opencode-ext-connector/cursor');
        const ollama = await import('opencode-ext-connector/ollama');
        const names = Object.keys(root).sort();
        const kinds = [claude.createClaude, commandCode.createCommandCode, cursor.createCursor, ollama.createOllama].map((value) => typeof value);
        const hooks = await root.claudeAuthServer({}, {});
        await hooks.dispose?.();
        process.stdout.write(JSON.stringify({ names, kinds }));
      `,
      )
      const output = await runPackageCommand({
        operation: "node-consumer",
        command: [process.env["NODE_BIN"] ?? "node", consumerFile],
        cwd: cacheProjectRoot,
        env,
      })

      // Then
      expect(JSON.parse(output)).toEqual({
        names: rootExportNames,
        kinds: ["function", "function", "function", "function"],
      })
    } finally {
      await packed?.cleanup()
      await rm(directory, { force: true, recursive: true })
    }
  }, 60_000)
})
