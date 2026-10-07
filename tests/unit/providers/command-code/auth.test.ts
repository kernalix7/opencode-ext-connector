import { afterEach, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { OperationCancelledError } from "../../../../src/core/errors"
import { readCommandCodeAccessToken } from "../../../../src/providers/command-code/auth"

const directories = new Set<string>()

afterEach(async () => {
  await Promise.all([...directories].map((path) => rm(path, { recursive: true, force: true })))
  directories.clear()
})

async function fixture(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "connector-command-reader-"))
  directories.add(home)
  return home
}

async function credentials(home: string, relative: string, value: unknown): Promise<void> {
  const path = join(home, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value), { mode: 0o600 })
}

it("prefers the shipped Command Code environment key over aliases", async () => {
  // Given
  const env = {
    COMMAND_CODE_API_KEY: "primary",
    COMMANDCODE_API_KEY: "alternate",
    CC_API_KEY: "last",
  }
  // When
  const token = await readCommandCodeAccessToken(env, new AbortController().signal)
  // Then
  expect(token).toBe("primary")
})

it.each(["apiKey", "accessToken", "token"])("reads file-only %s credentials", async (field) => {
  // Given
  const homeDir = await fixture()
  await credentials(homeDir, ".commandcode/auth.json", { [field]: "file-token" })
  // When
  const token = await readCommandCodeAccessToken({}, new AbortController().signal, { homeDir })
  // Then
  expect(token).toBe("file-token")
})

it("prefers XDG credentials over the home credential file", async () => {
  // Given
  const homeDir = await fixture()
  const xdg = join(homeDir, "xdg")
  await credentials(homeDir, ".commandcode/auth.json", { apiKey: "home-token" })
  await credentials(xdg, "commandcode/auth.json", { apiKey: "xdg-token" })
  // When
  const token = await readCommandCodeAccessToken(
    { XDG_CONFIG_HOME: xdg },
    new AbortController().signal,
    { homeDir },
  )
  // Then
  expect(token).toBe("xdg-token")
})

it("continues from malformed auth JSON to the shipped CLI config path", async () => {
  // Given
  const homeDir = await fixture()
  await credentials(homeDir, ".commandcode/cli-config.json", { accessToken: "config-token" })
  await writeFile(join(homeDir, ".commandcode/auth.json"), "{")
  // When
  const token = await readCommandCodeAccessToken({}, new AbortController().signal, { homeDir })
  // Then
  expect(token).toBe("config-token")
})

it("ignores another provider's generic token in the shared Pi file", async () => {
  // Given
  const homeDir = await fixture()
  await credentials(homeDir, ".pi/agent/auth.json", {
    token: "foreign-token",
    apiKey: "foreign-key",
  })
  // When
  const token = await readCommandCodeAccessToken({}, new AbortController().signal, { homeDir })
  // Then
  expect(token).toBeNull()
})

it.each(["scoped-token", { type: "oauth", access: "scoped-token" }])(
  "reads only the Command Code entry from shared Pi: %j",
  async (entry) => {
    // Given
    const homeDir = await fixture()
    await credentials(homeDir, ".pi/agent/auth.json", {
      token: "foreign-token",
      commandcode: entry,
    })
    // When
    const token = await readCommandCodeAccessToken({}, new AbortController().signal, { homeDir })
    // Then
    expect(token).toBe("scoped-token")
  },
)

it("returns unavailable when credential files are absent", async () => {
  // Given
  const homeDir = await fixture()
  // When
  const token = await readCommandCodeAccessToken({}, new AbortController().signal, { homeDir })
  // Then
  expect(token).toBeNull()
})

it("observes externally rotated file credentials on the next read", async () => {
  // Given
  const homeDir = await fixture()
  await credentials(homeDir, ".commandcode/auth.json", { apiKey: "first" })
  const initial = await readCommandCodeAccessToken({}, new AbortController().signal, { homeDir })
  expect(initial).toBe("first")
  await credentials(homeDir, ".commandcode/auth.json", { apiKey: "rotated" })
  // When
  const token = await readCommandCodeAccessToken({}, new AbortController().signal, { homeDir })
  // Then
  expect(token).toBe("rotated")
})

it("rejects cancellation before credential lookup", async () => {
  // Given
  const controller = new AbortController()
  controller.abort()
  // When / Then
  await expect(readCommandCodeAccessToken({}, controller.signal)).rejects.toBeInstanceOf(
    OperationCancelledError,
  )
})

it("rejects cancellation after a pending credential-file read", async () => {
  // Given
  const controller = new AbortController()
  const homeDir = await fixture()
  // When / Then
  await expect(
    readCommandCodeAccessToken({}, controller.signal, {
      homeDir,
      readFile: async () => {
        controller.abort()
        return '{"apiKey":"must-not-return"}'
      },
    }),
  ).rejects.toBeInstanceOf(OperationCancelledError)
})

it("does not hide unexpected errors from the file boundary", async () => {
  // Given
  const homeDir = await fixture()
  const failure = new TypeError("reader failure")
  // When / Then
  await expect(
    readCommandCodeAccessToken({}, new AbortController().signal, {
      homeDir,
      readFile: async () => {
        throw failure
      },
    }),
  ).rejects.toBe(failure)
})
