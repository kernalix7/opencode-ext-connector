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

type LifecycleCase = {
  readonly providerId: "claude" | "cursor" | "command-code"
  readonly authProvider: "anthropic" | "cursor" | "command-code"
}

const lifecycleCases: LifecycleCase[] = [
  { providerId: "claude", authProvider: "anthropic" },
  { providerId: "cursor", authProvider: "cursor" },
  { providerId: "command-code", authProvider: "command-code" },
]

function isolatedEnvironment(home: string): Readonly<Record<string, string>> {
  return {
    HOME: home,
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

async function closeAndAssert(server: Awaited<ReturnType<typeof startOpenCode>>): Promise<void> {
  const firstClose = server.close()
  expect(server.close()).toBe(firstClose)
  await firstClose
  expect(server.pid).toBeGreaterThan(0)
  expect(server.exitCode).toBe(await server.exited)
  await expect(fetch(server.url, { signal: AbortSignal.timeout(1_000) })).rejects.toBeDefined()
}

function lifecyclePlugin(): string {
  const authStoreUrl = pathToFileURL(join(projectRoot, "dist", "opencode", "auth-store.js")).href
  const moduleUrl = pathToFileURL(join(projectRoot, "dist", "opencode", "v1-module.js")).href
  return `
import { createOpenCodeAuthStore } from ${JSON.stringify(authStoreUrl)}
import { buildV1AuthHooks, buildV1Hooks } from ${JSON.stringify(moduleUrl)}

const env = process.env
const authStore = createOpenCodeAuthStore({ env })
const clock = {
  nowMs: () => 0,
  schedule: () => {
    const cancel = () => undefined
    return { cancel, [Symbol.dispose]: cancel }
  },
}
const transport = { request: async () => { throw new Error("fixture transport must stay offline") } }
const definitions = [
  ["claude", "anthropic", "fixture-claude-model"],
  ["cursor", "cursor", "fixture-cursor-model"],
  ["command-code", "command-code", "fixture-command-code-model"],
]
const vendorCredentials = new Set(definitions.map(([id]) => id))
const entries = definitions.map(([id, authProvider, modelId]) => ({
  id,
  displayName: id,
  integrationId: authProvider,
  integrationMethod: { type: "env", names: [] },
  createAdapter: () => ({
    providerId: id,
    snapshot: async () => ({ status: "ready", providerId: id, models: [{ id: modelId }] }),
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  }),
  createAuthHook: () => ({ provider: authProvider, methods: [{ type: "api", label: id }] }),
  isConnected: async (deps) => vendorCredentials.has(id) && (await deps.authStore.matchAuth(authProvider)) !== null,
}))
const deps = { env, authStore, clock, transport }
const npmSpecifiers = Object.fromEntries(definitions.map(([id]) => [id, "@ai-sdk/openai-compatible"]))

export const connectorServer = async () => buildV1Hooks({
  env,
  authStore,
  clock,
  transport,
  providers: entries,
  npmSpecifiers,
})
export const claudeAuthServer = async (_input, options) => buildV1AuthHooks(entries[0], deps, options)
export const cursorAuthServer = async (_input, options) => buildV1AuthHooks(entries[1], deps, options)
export const commandCodeAuthServer = async (_input, options) => buildV1AuthHooks(entries[2], deps, options)
`
}

async function setAuth(
  client: ReturnType<typeof createOpencodeClient>,
  provider: LifecycleCase["authProvider"],
): Promise<void> {
  switch (provider) {
    case "anthropic":
      await client.auth.set({
        path: { id: provider },
        body: { type: "oauth", access: "access", refresh: "refresh", expires: 4_102_444_800_000 },
      })
      return
    case "cursor":
      await client.auth.set({
        path: { id: provider },
        body: { type: "api", key: "cli-session:cursor" },
      })
      return
    case "command-code":
      await client.auth.set({
        path: { id: provider },
        body: { type: "api", key: "cli-session:command-code" },
      })
      return
  }
}

describe("OpenCode provider auth lifecycle", () => {
  it.each(lifecycleCases)(
    "publishes only offline fixture $providerId after its isolated auth record exists without exercising live vendor protocols",
    async ({ providerId, authProvider }) => {
      // Given
      const directory = await mkdtemp(join(tmpdir(), "opencode-provider-lifecycle-"))
      const home = join(directory, "home")
      const pluginPath = join(directory, "fixture.mjs")
      await mkdir(home, { recursive: true })
      await writeFile(pluginPath, lifecyclePlugin(), "utf8")
      await writeFile(
        join(directory, "opencode.json"),
        JSON.stringify({
          autoupdate: false,
          plugin: [pathToFileURL(pluginPath).href],
          share: "disabled",
        }),
        "utf8",
      )
      const processOptions = {
        binary: process.env["OPENCODE_BIN"] ?? "opencode",
        cwd: directory,
        env: isolatedEnvironment(home),
      }
      expectIsolatedEnvironment(processOptions.env, home)
      const authPath = join(processOptions.env["XDG_DATA_HOME"] ?? "", "opencode", "auth.json")
      expect(authPath.startsWith(home)).toBe(true)
      try {
        const initial = await startOpenCode(processOptions)
        try {
          const client = createOpencodeClient({ baseUrl: initial.url })
          const providers = await client.provider.list()
          const connectorIds = ["claude", "cursor", "command-code"]
          expect(providers.data?.connected.filter((id) => connectorIds.includes(id))).toEqual([])
          await setAuth(client, authProvider)
          expect(await Bun.file(authPath).exists()).toBe(true)
        } finally {
          await closeAndAssert(initial)
        }

        // When
        const restarted = await startOpenCode(processOptions)
        try {
          const providers = await createOpencodeClient({ baseUrl: restarted.url }).provider.list()

          // Then
          expect(
            providers.data?.connected.filter((id) =>
              ["claude", "cursor", "command-code"].includes(id),
            ),
          ).toEqual([providerId])
          const selected = providers.data?.all.find((provider) => provider.id === providerId)
          expect(Object.keys(selected?.models ?? {})).not.toHaveLength(0)
        } finally {
          await closeAndAssert(restarted)
        }
      } finally {
        await rm(directory, { force: true, recursive: true })
        await expect(access(directory)).rejects.toBeDefined()
      }
    },
    30_000,
  )
})
