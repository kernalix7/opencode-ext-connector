import { expect, it } from "bun:test"

import { parseConnectorOptions } from "../../../src/core/options"

it("defaults to the three supported providers and preserves bounded timing", () => {
  // Given / When
  const options = parseConnectorOptions({})
  // Then
  expect(options.providers).toEqual(["claude", "command-code", "ollama"])
  expect(options.snapshotTimeoutMs).toBe(30_000)
  expect(options.health).toEqual({ initialBackoffMs: 1_000, maximumBackoffMs: 60_000 })
})

it.each([
  "credentialRole",
  "credentialManagement",
  "credentialAuthority",
  "credentialRefresh",
  "writeBackCredentials",
  "xaiOAuth",
])("rejects invalid %s before constructing resources", (field) => {
  // Given / When
  const parse = () => parseConnectorOptions({ [field]: "invalid" })
  // Then
  expect(parse).toThrow()
})

it("rejects Cursor and unknown providers instead of silently dropping them", () => {
  // Given / When
  const parse = () => parseConnectorOptions({ providers: ["cursor"] })
  // Then
  expect(parse).toThrow()
})

it("honors explicit empty providers and rejects invalid health bounds", () => {
  // Given / When
  const empty = parseConnectorOptions({ providers: [] })
  const invalid = () =>
    parseConnectorOptions({ health: { initialBackoffMs: 30, maximumBackoffMs: 20 } })
  // Then
  expect(empty.providers).toEqual([])
  expect(invalid).toThrow("initial backoff exceeds maximum")
})

it.each(["owner", "reader"])("normalizes %s ownership into existing policy fields", (role) => {
  // Given / When
  const options = parseConnectorOptions({ credentialRole: role })
  // Then
  expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 60_000 })
  expect(options.writeBackCredentials).toBe(false)
  expect(options.credentialAuthority.claudeCli).toEqual({
    enabled: role === "owner",
    leadMs: 300_000,
    retryMs: 300_000,
  })
  expect("credentialRole" in options).toBe(false)
})

it.each(["connector", "external"])("normalizes %s credential management", (management) => {
  // Given / When
  const options = parseConnectorOptions({ credentialManagement: management })
  // Then
  expect(options.credentialRefresh).toEqual({
    mode: management === "connector" ? "auto" : "never",
    leadMs: 60_000,
  })
  expect(options.writeBackCredentials).toBe(management === "connector")
  expect("credentialManagement" in options).toBe(false)
})

it("preserves legacy refresh defaults without authorizing writeback", () => {
  // Given / When
  const options = parseConnectorOptions({})
  // Then
  expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
  expect(options.writeBackCredentials).toBe(false)
  expect(options.credentialAuthority.claudeCli.enabled).toBe(false)
})

it("preserves explicit legacy refresh settings and writeback", () => {
  // Given / When
  const options = parseConnectorOptions({
    credentialRefresh: { mode: "never", leadMs: 123 },
    writeBackCredentials: true,
  })
  // Then
  expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 123 })
  expect(options.writeBackCredentials).toBe(true)
})

it.each([
  { credentialManagement: "external" },
  { credentialAuthority: { claudeCli: { enabled: false } } },
  { credentialRefresh: { mode: "never" } },
  { writeBackCredentials: false },
])("rejects roles combined with low-level policies: %j", (policy) => {
  // Given / When / Then
  expect(() => parseConnectorOptions({ credentialRole: "reader", ...policy })).toThrow()
})

it.each([{ credentialRefresh: {} }, { writeBackCredentials: false }])(
  "rejects management combined with legacy policy: %j",
  (policy) => {
    // Given / When / Then
    expect(() => parseConnectorOptions({ credentialManagement: "external", ...policy })).toThrow()
  },
)

it("requires Claude for owner authority", () => {
  // Given / When / Then
  expect(() => parseConnectorOptions({ providers: ["ollama"], credentialRole: "owner" })).toThrow()
})

it.each([{ providers: ["claude"] }, { providers: ["ollama"], credentialManagement: "external" }])(
  "rejects enabled authority without its prerequisites: %j",
  (input) => {
    // Given / When / Then
    expect(() =>
      parseConnectorOptions({ ...input, credentialAuthority: { claudeCli: { enabled: true } } }),
    ).toThrow()
  },
)

it("normalizes explicit authority timing under external management", () => {
  // Given / When
  const options = parseConnectorOptions({
    credentialManagement: "external",
    credentialAuthority: { claudeCli: { enabled: true, leadMs: 0, retryMs: 1 } },
  })
  // Then
  expect(options.credentialAuthority.claudeCli).toEqual({ enabled: true, leadMs: 0, retryMs: 1 })
})

it.each([
  { credentialRefresh: { leadMs: -1 } },
  { credentialRefresh: { leadMs: 2_147_483_648 } },
  { credentialAuthority: { claudeCli: { enabled: false, leadMs: -1 } } },
  { credentialAuthority: { claudeCli: { enabled: false, retryMs: 0 } } },
])("rejects invalid credential timing: %j", (input) => {
  // Given / When / Then
  expect(() => parseConnectorOptions(input)).toThrow()
})

it.each([false, undefined])("keeps present xaiOAuth rejected: %j", (value) => {
  // Given / When / Then
  expect(() => parseConnectorOptions({ xaiOAuth: value })).toThrow("xaiOAuth was retired")
})

it("returns deeply frozen normalized policy", () => {
  // Given / When
  const options = parseConnectorOptions({ credentialRole: "reader" })
  // Then
  for (const value of [
    options,
    options.providers,
    options.health,
    options.credentialRefresh,
    options.credentialAuthority,
    options.credentialAuthority.claudeCli,
  ]) {
    expect(Object.isFrozen(value)).toBe(true)
  }
})
