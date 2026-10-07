import { expect, it } from "bun:test"
import {
  createClaudeKeychainReaders,
  updateClaudeCredentialBlob,
  writeClaudeCredentials,
} from "../../../../src/providers/claude/writeback"

const old = JSON.stringify({
  claudeAiOauth: { accessToken: "prior", refreshToken: "old", expiresAt: 0, plan: "kept" },
  unrelated: { ok: true },
})
const rotated = { accessToken: "next", refreshToken: "new", expiresAtMs: 3600 }

it("preserves unrelated fields and declines a stale prior token", () => {
  // Given / When
  const valid = updateClaudeCredentialBlob(old, rotated, "prior")
  const stale = updateClaudeCredentialBlob(old, rotated, "foreign")
  // Then
  expect(JSON.parse(valid ?? "{}")).toMatchObject({
    claudeAiOauth: { plan: "kept", accessToken: "next" },
    unrelated: { ok: true },
  })
  expect(stale).toBeNull()
})

it("does not write without explicit capability or a matching current source", async () => {
  // Given
  const writes: string[] = []
  const hooks = {
    source: "file" as const,
    expectedPriorAccessToken: "prior",
    readFile: async () => old,
    writeFile: async (_path: string, body: string) => {
      writes.push(body)
    },
    platform: "linux",
  }
  // When
  const disabled = await writeClaudeCredentials(
    { CLAUDE_CONFIG_DIR: "/synthetic", XDG_DATA_HOME: "/synthetic" },
    rotated,
    { ...hooks, enabled: false },
  )
  const stale = await writeClaudeCredentials(
    { CLAUDE_CONFIG_DIR: "/synthetic", XDG_DATA_HOME: "/synthetic" },
    rotated,
    { ...hooks, enabled: true, expectedPriorAccessToken: "other" },
  )
  // Then
  expect(disabled).toBe(false)
  expect(stale).toBe(false)
  expect(writes).toEqual([])
})

it("reads the current Keychain value and account using a scoped command", async () => {
  // Given
  const calls: string[][] = []
  const readers = createClaudeKeychainReaders(async (args) => {
    calls.push([...args])
    return args.includes("-w")
      ? { stdout: old, stderr: "" }
      : { stdout: "", stderr: 'keychain: "acct"<blob>="account"' }
  })
  // When
  const value = await readers.readKeychainValue()
  const dump = await readers.readKeychainDump()
  // Then
  expect(value).toBe(old)
  expect(dump).toContain('"acct"<blob>="account"')
  expect(calls).toEqual([
    ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
    ["find-generic-password", "-s", "Claude Code-credentials", "-g"],
  ])
})

it("writes an enabled Keychain source with its matching account and prior token", async () => {
  // Given
  const writes: (readonly string[])[] = []
  // When
  const result = await writeClaudeCredentials({ XDG_DATA_HOME: "/synthetic" }, rotated, {
    enabled: true,
    source: "keychain",
    expectedPriorAccessToken: "prior",
    platform: "darwin",
    readKeychainValue: async () => old,
    readKeychainDump: async () => '"acct"<blob>="selected"',
    readFile: async () => null,
    writeKeychain: async (args) => {
      writes.push(args)
    },
  })
  // Then
  expect(result).toBe(true)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toContain("selected")
  const body = writes[0]?.at(-1)
  expect(JSON.parse(body ?? "{}")).toMatchObject({
    claudeAiOauth: { accessToken: "next", plan: "kept" },
    unrelated: { ok: true },
  })
})
