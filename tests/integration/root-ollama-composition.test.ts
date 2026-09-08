import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import { getTestPackageDist, getTestPackageRoot } from "../support/test-package"

const childScript = `
const plugin = await import(process.env.CONNECTOR_PLUGIN_URL)
const sdk = await import(process.env.CONNECTOR_SDK_URL)
const baseURL = process.env.OLLAMA_BASE_URL
const options = { providers: JSON.parse(process.env.CONNECTOR_PROVIDERS), ollamaBaseURL: baseURL }
const requests = []
const originalFetch = globalThis.fetch
const requestURL = (input) => input instanceof Request ? input.url : typeof input === "string" ? input : input.href
globalThis.fetch = async (input, init) => {
  const url = requestURL(input)
  requests.push({ url, redirect: init?.redirect ?? null, credentials: init?.credentials ?? null })
  if (url === "https://ollama.com/search?c=cloud") return new Response('<a href="/library/fixture">fixture</a>')
  if (url === "https://ollama.com/library/fixture") return new Response('<a href="/library/fixture:cloud">cloud</a>')
  if (!url.startsWith(baseURL)) throw new Error("unexpected network request: " + url)
  return originalFetch(input, init)
}
try {
  const hooks = await plugin.connectorServer({}, options)
  if (!options.providers.includes("ollama")) {
    await hooks.dispose?.()
    console.log(JSON.stringify({ kind: "disabled", requests }))
  } else {
    const config = {}
    await hooks.config(config)
    const authHooks = await plugin.ollamaAuthServer({}, options)
    const method = authHooks.auth?.methods.find((candidate) => candidate.type === "oauth")
    if (method === undefined) throw new Error("Ollama auth method is missing")
    const authorization = await method.authorize({})
    const authResult = await authorization.callback()
    const model = sdk.createOllama({ ollamaBaseURL: baseURL }).languageModel("root:latest")
    const parts = await Array.fromAsync((await model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] })).stream)
    await hooks.dispose?.()
    console.log(JSON.stringify({ kind: "active", providerOptions: config.provider?.ollama?.options, authResult, text: parts.flatMap((part) => part.type === "text-delta" ? [part.delta] : []), requests }))
  }
} finally {
  globalThis.fetch = originalFetch
}
`

const requestSchema = z.object({
  url: z.string(),
  redirect: z.union([z.literal("error"), z.null()]),
  credentials: z.union([z.literal("omit"), z.null()]),
})

const resultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled"), requests: z.array(requestSchema) }),
  z.object({
    kind: z.literal("active"),
    providerOptions: z.object({ ollamaBaseURL: z.string() }),
    authResult: z.object({ type: z.literal("success"), provider: z.literal("ollama") }),
    text: z.array(z.string()),
    requests: z.array(requestSchema),
  }),
])

type RootResult = z.infer<typeof resultSchema>

type RunOptions = {
  readonly baseURL: string
  readonly providers: readonly string[]
}

type DaemonRequest = {
  readonly path: string
  readonly hasAuthorization: boolean
  readonly hasCookie: boolean
}

class LoopbackOllama implements AsyncDisposable {
  public readonly requests: DaemonRequest[] = []
  public readonly baseURL: string
  private readonly server: ReturnType<typeof Bun.serve>

  public constructor() {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname
        this.requests.push({
          path,
          hasAuthorization: request.headers.has("authorization"),
          hasCookie: request.headers.has("cookie"),
        })
        switch (path) {
          case "/prefix/api/tags":
            return Response.json({ models: [{ name: "root:latest" }] })
          case "/prefix/api/chat":
            return new Response(
              '{"message":{"role":"assistant","content":"root"},"done":false}\n{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}\n',
              { headers: { "content-type": "application/x-ndjson" } },
            )
          default:
            return new Response(null, { status: 404 })
        }
      },
    })
    this.baseURL = new URL("prefix", this.server.url).href.replace(/\/$/u, "")
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.server.stop(true)
  }
}

async function runBuiltPackage(options: RunOptions): Promise<RootResult> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-root-ollama-"))
  const home = join(directory, "home")
  const data = join(home, "data")
  await mkdir(join(data, "opencode"), { recursive: true })
  await writeFile(
    join(data, "opencode", "auth.json"),
    JSON.stringify({ ollama: { type: "api", key: "cli-session:ollama" } }),
    "utf8",
  )
  const script = join(directory, "root-ollama.mjs")
  await writeFile(script, childScript, "utf8")
  try {
    const pluginProcess = Bun.spawn([process.execPath, script], {
      cwd: getTestPackageRoot(),
      env: {
        HOME: home,
        PATH: process.env["PATH"] ?? "",
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_DATA_HOME: data,
        CONNECTOR_PLUGIN_URL: new URL("index.js", `file://${getTestPackageDist()}/`).href,
        CONNECTOR_SDK_URL: new URL("sdk/ollama.js", `file://${getTestPackageDist()}/`).href,
        CONNECTOR_PROVIDERS: JSON.stringify(options.providers),
        OLLAMA_BASE_URL: options.baseURL,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      pluginProcess.exited,
      new Response(pluginProcess.stdout).text(),
      new Response(pluginProcess.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    return resultSchema.parse(JSON.parse(stdout))
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

describe("built root Ollama composition", () => {
  it("ignores an invalid daemon base when Ollama is excluded", async () => {
    // Given / When
    const result = await runBuiltPackage({ baseURL: "https://ollama.com", providers: [] })

    // Then
    expect(result.kind).toBe("disabled")
    expect(result.requests).toEqual([])
  })

  it("routes root connector auth and SDK through a normalized prefixed daemon", async () => {
    // Given
    await using daemon = new LoopbackOllama()

    // When
    const result = await runBuiltPackage({
      baseURL: `${daemon.baseURL}/`,
      providers: ["ollama"],
    })

    // Then
    expect(result.kind).toBe("active")
    if (result.kind !== "active") throw new Error("Ollama root composition was not active")
    expect(result.providerOptions).toEqual({ ollamaBaseURL: daemon.baseURL })
    expect(result.authResult).toMatchObject({ type: "success", provider: "ollama" })
    expect(result.text).toEqual(["root"])
    expect(result.requests.filter(({ url }) => url.startsWith(daemon.baseURL))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: `${daemon.baseURL}/api/tags`,
          redirect: "error",
          credentials: "omit",
        }),
        expect.objectContaining({
          url: `${daemon.baseURL}/api/chat`,
          redirect: "error",
          credentials: "omit",
        }),
      ]),
    )
    expect(daemon.requests.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["/prefix/api/tags", "/prefix/api/chat"]),
    )
    expect(daemon.requests.every(({ hasAuthorization }) => !hasAuthorization)).toBe(true)
    expect(daemon.requests.every(({ hasCookie }) => !hasCookie)).toBe(true)
  })
})
