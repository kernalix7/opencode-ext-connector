import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createOpenCodeAuthStore,
  type OpenCodeAuthProvider,
  opencodeAuthJsonPaths,
} from "../../../src/opencode/auth-store"

const temporaryDirectories: string[] = []
const matchingAuthCases: [OpenCodeAuthProvider, Record<string, unknown>][] = [
  [
    "anthropic",
    {
      anthropic: {
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: 9,
        accountId: "account",
        enterpriseUrl: "https://enterprise.example",
      },
    },
  ],
  ["cursor", { cursor: { type: "api", key: "cli-session:cursor", metadata: { source: "cli" } } }],
  ["command-code", { "command-code": { type: "api", key: "cli-session:command-code" } }],
  ["command-code", { "command-code": { type: "api", key: "real-command-code-key" } }],
]

async function createAuthStore(contents?: string) {
  const root = await mkdtemp(join(tmpdir(), "connector-auth-store-"))
  temporaryDirectories.push(root)
  const dataHome = join(root, "data")
  if (contents !== undefined) {
    const directory = join(dataHome, "opencode")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "auth.json"), contents, "utf8")
  }
  return createOpenCodeAuthStore({
    env: { HOME: join(root, "home"), XDG_DATA_HOME: dataHome },
    platform: "linux",
  })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("opencodeAuthJsonPaths", () => {
  it("uses injected home, XDG data, and platform locations", () => {
    // Given / When
    const linux = opencodeAuthJsonPaths(
      { HOME: "/isolated/home", XDG_DATA_HOME: "/isolated/data" },
      "linux",
    )
    const mac = opencodeAuthJsonPaths({ HOME: "/isolated/home" }, "darwin")
    const windows = opencodeAuthJsonPaths(
      { HOME: "C:\\isolated", LOCALAPPDATA: "C:\\Local" },
      "win32",
    )

    // Then
    expect(linux).toEqual(["/isolated/data/opencode/auth.json"])
    expect(mac).toEqual(["/isolated/home/Library/Application Support/opencode/auth.json"])
    expect(windows).toEqual(["C:\\Local/opencode/auth.json"])
  })
})

describe("OpenCode auth store", () => {
  it.each(matchingAuthCases)("recognizes a matching %s record", async (provider, auth) => {
    // Given
    const store = await createAuthStore(JSON.stringify(auth))

    // When
    const connected = (await store.matchAuth(provider)) !== null

    // Then
    expect(connected).toBe(true)
  })

  it("returns a parsed direct Command Code API key match", async () => {
    // Given
    const store = await createAuthStore(
      JSON.stringify({ "command-code": { type: "api", key: "direct-command-key" } }),
    )

    // When
    const match = await store.matchAuth("command-code")

    // Then
    expect(match).toEqual({ kind: "api-key", key: "direct-command-key" })
  })

  it.each([
    ["missing file", undefined],
    ["malformed JSON", "{"],
    ["invalid root schema", "[]"],
    ["invalid provider schema", JSON.stringify({ cursor: { type: "api" } })],
    [
      "unknown provider field",
      JSON.stringify({ cursor: { type: "api", key: "cli-session:cursor", extra: true } }),
    ],
    [
      "wrong provider marker",
      JSON.stringify({ cursor: { type: "api", key: "cli-session:command-code" } }),
    ],
    [
      "another provider record",
      JSON.stringify({ "command-code": { type: "api", key: "cli-session:command-code" } }),
    ],
  ])("returns disconnected for %s", async (_case, contents) => {
    // Given
    const store = await createAuthStore(contents)

    // When
    const connected = (await store.matchAuth("cursor")) !== null

    // Then
    expect(connected).toBe(false)
  })

  it("propagates unexpected filesystem errors", async () => {
    // Given
    const expected = new Error("permission denied")
    const store = createOpenCodeAuthStore({
      env: { HOME: "/isolated/home" },
      platform: "linux",
      readFile: async () => Promise.reject(expected),
    })

    // When
    const result = store.matchAuth("anthropic")

    // Then
    await expect(result).rejects.toBe(expected)
  })
})
