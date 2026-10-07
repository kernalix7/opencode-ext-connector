import { afterEach, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OperationCancelledError } from "../../../../src/core/errors"
import { readClaudeAccessToken, readClaudeCredentials } from "../../../../src/providers/claude/auth"
import { parseClaudeCredentials } from "../../../../src/providers/claude/credentials"

const directories = new Set<string>()
const oauth = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  expiresAt: 1_900_000_000_000,
}
const noKeychain = { readKeychain: async () => null }

afterEach(async () => {
  await Promise.all([...directories].map((path) => rm(path, { recursive: true, force: true })))
  directories.clear()
})

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "connector-claude-reader-"))
  directories.add(directory)
  return directory
}

async function credentialFile(directory: string, accessToken: string): Promise<void> {
  await writeFile(
    join(directory, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: { ...oauth, accessToken },
    }),
    { mode: 0o600 },
  )
}

it.each([oauth, { claudeAiOauth: oauth }])(
  "parses a complete existing OAuth record: %j",
  (value) => {
    // Given / When
    const result = parseClaudeCredentials(value)
    // Then
    expect(result).toEqual({
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAtMs: oauth.expiresAt,
    })
  },
)

it.each(
  [
    null,
    [],
    { accessToken: "only-access" },
    { ...oauth, accessToken: "" },
    { ...oauth, refreshToken: "" },
    { ...oauth, expiresAt: Number.POSITIVE_INFINITY },
    { claudeAiOauth: null, ...oauth },
  ].map((value) => ({ value })),
)("rejects incomplete or malformed credential input: %j", ({ value }) => {
  // Given / When / Then
  expect(parseClaudeCredentials(value)).toBeNull()
})

it("preserves the legacy finite-expiry truncation", () => {
  // Given / When
  const result = parseClaudeCredentials({ ...oauth, expiresAt: 123.75 })
  // Then
  expect(result?.expiresAtMs).toBe(123)
})

it("prefers injected Keychain credentials to a different file token", async () => {
  // Given
  const directory = await fixture()
  await credentialFile(directory, "file-token")
  // When
  const token = await readClaudeAccessToken(
    { CLAUDE_CONFIG_DIR: directory },
    new AbortController().signal,
    { readKeychain: async () => JSON.stringify(oauth) },
  )
  // Then
  expect(token).toBe(oauth.accessToken)
})

it.each([null, "{", '{"accessToken":"incomplete"}'])(
  "reads the configured credential file after unusable Keychain data: %j",
  async (raw) => {
    // Given
    const directory = await fixture()
    await credentialFile(directory, "file-token")
    // When
    const result = await readClaudeCredentials(
      { CLAUDE_CONFIG_DIR: directory },
      new AbortController().signal,
      { readKeychain: async () => raw },
    )
    // Then
    expect(result?.accessToken).toBe("file-token")
  },
)

it("does not substitute an API key when the existing login is missing", async () => {
  // Given
  const directory = await fixture()
  // When
  const token = await readClaudeAccessToken(
    { CLAUDE_CONFIG_DIR: directory, ANTHROPIC_API_KEY: "must-not-substitute" },
    new AbortController().signal,
    noKeychain,
  )
  // Then
  expect(token).toBeNull()
})

it("returns unavailable for malformed file JSON", async () => {
  // Given
  const directory = await fixture()
  await writeFile(join(directory, ".credentials.json"), "{")
  // When
  const token = await readClaudeAccessToken(
    { CLAUDE_CONFIG_DIR: directory },
    new AbortController().signal,
    noKeychain,
  )
  // Then
  expect(token).toBeNull()
})

it("observes externally rotated file credentials on the next read", async () => {
  // Given
  const directory = await fixture()
  await credentialFile(directory, "first")
  const env = { CLAUDE_CONFIG_DIR: directory }
  expect(await readClaudeAccessToken(env, new AbortController().signal, noKeychain)).toBe("first")
  await credentialFile(directory, "rotated")
  // When
  const token = await readClaudeAccessToken(env, new AbortController().signal, noKeychain)
  // Then
  expect(token).toBe("rotated")
})

it("propagates a Keychain access error instead of using another credential source", async () => {
  // Given
  const directory = await fixture()
  await credentialFile(directory, "must-not-use")
  const failure = new Error("synthetic Keychain denied")
  // When / Then
  await expect(
    readClaudeAccessToken({ CLAUDE_CONFIG_DIR: directory }, new AbortController().signal, {
      readKeychain: async () => {
        throw failure
      },
    }),
  ).rejects.toBe(failure)
})

it("rejects cancellation before looking up credentials", async () => {
  // Given
  const controller = new AbortController()
  controller.abort()
  // When / Then
  await expect(readClaudeAccessToken({}, controller.signal, noKeychain)).rejects.toBeInstanceOf(
    OperationCancelledError,
  )
})

it("rejects cancellation after a Keychain read", async () => {
  // Given
  const controller = new AbortController()
  // When / Then
  await expect(
    readClaudeAccessToken({}, controller.signal, {
      readKeychain: async () => {
        controller.abort()
        return JSON.stringify(oauth)
      },
    }),
  ).rejects.toBeInstanceOf(OperationCancelledError)
})

it("rejects cancellation after a credential-file read", async () => {
  // Given
  const controller = new AbortController()
  const directory = await fixture()
  // When / Then
  await expect(
    readClaudeAccessToken({ CLAUDE_CONFIG_DIR: directory }, controller.signal, {
      ...noKeychain,
      readFile: async () => {
        controller.abort()
        return JSON.stringify(oauth)
      },
    }),
  ).rejects.toBeInstanceOf(OperationCancelledError)
})
