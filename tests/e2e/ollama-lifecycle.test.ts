import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createOpencodeClient } from "@opencode-ai/sdk"

import { startOpenCode } from "../support/opencode-process"
import { getTestPackageDist, getTestPackageRoot } from "../support/test-package"

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
  "OLLAMA_API_KEY",
  "OLLAMA_HOST",
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

function expectHermeticEnvironment(env: Readonly<Record<string, string>>, home: string): void {
  expect(env["HOME"]).toBe(home)
  expect(env["XDG_CACHE_HOME"]?.startsWith(home)).toBe(true)
  expect(env["XDG_CONFIG_HOME"]?.startsWith(home)).toBe(true)
  expect(env["XDG_DATA_HOME"]?.startsWith(home)).toBe(true)
  expect(env["NPM_CONFIG_OFFLINE"]).toBe("true")
  expect(env["OPENCODE_DISABLE_MODELS_FETCH"]).toBe("1")
  for (const key of blockedEnvironmentKeys) expect(env[key]).toBeUndefined()
}

async function withOpenCode(
  providers: readonly string[],
  run: (url: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-ollama-lifecycle-"))
  const home = join(directory, "home")
  await mkdir(home, { recursive: true })
  const plugin = pathToFileURL(join(getTestPackageDist(), "index.js")).href
  await writeFile(
    join(directory, "opencode.json"),
    JSON.stringify({ autoupdate: false, plugin: [[plugin, { providers }]], share: "disabled" }),
    "utf8",
  )
  const env = isolatedEnvironment(home)
  expectHermeticEnvironment(env, home)
  const server = await startOpenCode({
    binary: process.env["OPENCODE_BIN"] ?? "opencode",
    cwd: directory,
    env,
  })
  try {
    await run(server.url)
  } finally {
    await server.close()
    await rm(directory, { force: true, recursive: true })
  }
}

describe("Ollama package and disconnected OpenCode lifecycle", () => {
  it("starts with only Ollama configured but no marker and publishes no Ollama models", async () => {
    // Given
    const providers = ["ollama"]

    // When
    await withOpenCode(providers, async (url) => {
      const client = createOpencodeClient({ baseUrl: url })
      const auth = await client.provider.auth()
      const catalog = await client.provider.list()

      // Then
      expect(Object.keys(auth.data ?? {})).toContain("ollama")
      expect(catalog.data?.connected).not.toContain("ollama")
      expect(catalog.data?.all.find(({ id }) => id === "ollama")).toBeUndefined()
    })
  }, 20_000)

  it("omits the Ollama auth hook and catalog when providers is explicitly empty", async () => {
    // Given
    const providers: readonly string[] = []

    // When
    await withOpenCode(providers, async (url) => {
      const client = createOpencodeClient({ baseUrl: url })
      const auth = await client.provider.auth()
      const catalog = await client.provider.list()

      // Then
      expect(Object.keys(auth.data ?? {})).not.toContain("ollama")
      expect(catalog.data?.connected).not.toContain("ollama")
      expect(catalog.data?.all.find(({ id }) => id === "ollama")).toBeUndefined()
    })
  }, 20_000)

  it("resolves the built Ollama package export and constructs its SDK model", async () => {
    // Given
    const script = `
      import { createOllama } from "opencode-ext-connector/ollama"
      const model = createOllama().languageModel("fixture:latest")
      if (model.provider !== "ollama" || model.modelId !== "fixture:latest") process.exit(2)
    `

    // When
    const sdkHome = await mkdtemp(join(tmpdir(), "opencode-ollama-sdk-home-"))
    try {
      const sdkProcess = Bun.spawn([process.execPath, "--eval", script], {
        cwd: getTestPackageRoot(),
        env: isolatedEnvironment(sdkHome),
        stdout: "ignore",
        stderr: "pipe",
      })
      const exitCode = await sdkProcess.exited
      const stderr = await new Response(sdkProcess.stderr).text()

      // Then
      expect(exitCode, stderr).toBe(0)
      expect(stderr).toBe("")
    } finally {
      await rm(sdkHome, { force: true, recursive: true })
    }
  })
})
