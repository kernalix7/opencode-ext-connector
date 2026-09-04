import { describe, expect, it } from "bun:test"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createOpencodeClient } from "@opencode-ai/sdk"

import { startOpenCode } from "../support/opencode-process"

const projectRoot = join(import.meta.dir, "..", "..")
const blockedEnvironmentKeys = [
  "ALL_PROXY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "COMMAND_CODE_API_KEY",
  "CURSOR_ACCESS_TOKEN",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
] as const

function isolatedEnvironment(home: string): Readonly<Record<string, string>> {
  return {
    HOME: home,
    NPM_CONFIG_OFFLINE: "true",
    PATH: process.env["PATH"] ?? "",
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  }
}

function expectIsolatedEnvironment(env: Readonly<Record<string, string>>, home: string): void {
  expect(Object.keys(env).sort()).toEqual([
    "HOME",
    "NPM_CONFIG_OFFLINE",
    "OPENCODE_DISABLE_AUTOUPDATE",
    "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS",
    "OPENCODE_DISABLE_DEFAULT_PLUGINS",
    "OPENCODE_DISABLE_EXTERNAL_SKILLS",
    "OPENCODE_DISABLE_MODELS_FETCH",
    "PATH",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ])
  expect(env["OPENCODE_DISABLE_AUTOUPDATE"]).toBe("1")
  expect(env["OPENCODE_DISABLE_MODELS_FETCH"]).toBe("1")
  expect(env["HOME"]).toBe(home)
  expect(env["XDG_CACHE_HOME"]?.startsWith(home)).toBe(true)
  expect(env["XDG_CONFIG_HOME"]?.startsWith(home)).toBe(true)
  expect(env["XDG_DATA_HOME"]?.startsWith(home)).toBe(true)
  for (const key of blockedEnvironmentKeys) {
    expect(env[key]).toBeUndefined()
  }
}

async function expectClosed(url: string): Promise<void> {
  await expect(fetch(url, { signal: AbortSignal.timeout(1_000) })).rejects.toBeDefined()
}

function staticLegacyPlugin(): string {
  return `
const auth = (provider) => async () => ({ auth: { provider, methods: [{ type: "api", label: provider }] } })
export const catalogServer = async () => ({
  config: async (config) => {
    config.provider = {
      ...config.provider,
      "fixture-catalog": {
        name: "Fixture catalog",
        npm: "@ai-sdk/openai-compatible",
        models: { "fixture-model": { id: "fixture-model", name: "Fixture model" } },
      },
    }
  },
})
export const firstAuthServer = auth("fixture-first")
export const secondAuthServer = auth("fixture-second")
export const thirdAuthServer = auth("fixture-third")
`
}

async function writeConfig(directory: string, plugin: string): Promise<void> {
  await writeFile(
    join(directory, "opencode.json"),
    JSON.stringify({ autoupdate: false, plugin: [plugin], share: "disabled" }),
    "utf8",
  )
}

async function withOpenCode(plugin: string, run: (url: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-legacy-loader-"))
  const home = join(directory, "home")
  await mkdir(home, { recursive: true })
  await writeConfig(directory, plugin)
  const env = isolatedEnvironment(home)
  expectIsolatedEnvironment(env, home)
  expect(join(env["XDG_DATA_HOME"] ?? "", "opencode", "auth.json").startsWith(home)).toBe(true)
  const server = await startOpenCode({
    binary: process.env["OPENCODE_BIN"] ?? "opencode",
    cwd: directory,
    env,
  })
  try {
    await run(server.url)
  } finally {
    const firstClose = server.close()
    expect(server.close()).toBe(firstClose)
    await firstClose
    expect(server.pid).toBeGreaterThan(0)
    expect(server.exitCode).toBe(await server.exited)
    await expectClosed(server.url)
    await rm(directory, { force: true, recursive: true })
    await expect(access(directory)).rejects.toBeDefined()
  }
}

describe("OpenCode legacy multi-function loader", () => {
  it("runs every function export from one static plugin entry", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-legacy-fixture-"))
    const pluginPath = join(directory, "fixture.mjs")
    await writeFile(pluginPath, staticLegacyPlugin(), "utf8")
    try {
      // When
      await withOpenCode(pathToFileURL(pluginPath).href, async (url) => {
        const client = createOpencodeClient({ baseUrl: url })
        const auth = await client.provider.auth()
        const providers = await client.provider.list()
        // Then
        expect(auth.data).toBeDefined()
        expect(providers.data).toBeDefined()
        expect(Object.keys(auth.data ?? {}).sort()).toEqual([
          "fixture-first",
          "fixture-second",
          "fixture-third",
        ])
        expect(providers.data?.all).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "fixture-catalog",
              models: expect.objectContaining({ "fixture-model": expect.any(Object) }),
            }),
          ]),
        )
      })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 20_000)

  it("exposes all package auth hooks from one configured entry", async () => {
    // Given
    const plugin = pathToFileURL(join(projectRoot, "dist", "index.js")).href
    // When
    await withOpenCode(plugin, async (url) => {
      const client = createOpencodeClient({ baseUrl: url })
      const auth = await client.provider.auth()
      // Then
      expect(auth.data).toBeDefined()
      expect(Object.keys(auth.data ?? {})).toEqual(
        expect.arrayContaining(["anthropic", "cursor", "command-code", "ollama"]),
      )
    })
  }, 20_000)
})
