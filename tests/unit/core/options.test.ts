import { describe, expect, it } from "bun:test"

import {
  type ConnectorOptionsInput,
  ConnectorOptionsSchema,
  parseConnectorOptions,
} from "../../../src/core/options"

describe("connector options", () => {
  it("selects all providers by default", () => {
    // Given
    const input = {}
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options).toEqual({
      providers: ["claude", "cursor", "command-code", "ollama"],
      snapshotTimeoutMs: 30_000,
      writeBackCredentials: false,
      credentialRefresh: { mode: "auto", leadMs: 60_000 },
      credentialAuthority: {
        claudeCli: { enabled: false, leadMs: 300_000, retryMs: 300_000 },
      },
      catalogReloadMs: 300_000,
      health: { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
    })
    expect(Object.isFrozen(options)).toBe(true)
    expect(Object.isFrozen(options.health)).toBe(true)
    expect(Object.isFrozen(options.credentialRefresh)).toBe(true)
    expect(Object.isFrozen(options.credentialAuthority)).toBe(true)
    expect(Object.isFrozen(options.credentialAuthority.claudeCli)).toBe(true)
  })

  it("accepts a read-only credential refresh policy with a custom lead time", () => {
    // Given
    const input = { credentialRefresh: { mode: "never", leadMs: 1_800_000 } }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 1_800_000 })
  })

  it("maps connector credential management to automatic refresh and writeback", () => {
    // Given
    const input = { credentialManagement: "connector" }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(true)
    expect("credentialManagement" in options).toBe(false)
  })

  it("treats explicitly undefined legacy values as absent in connector mode", () => {
    // Given
    const input = {
      credentialManagement: "connector",
      credentialRefresh: undefined,
      writeBackCredentials: undefined,
    }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(true)
    expect("credentialManagement" in options).toBe(false)
  })

  it("maps external credential management to disabled refresh and no writeback", () => {
    // Given
    const input = { credentialManagement: "external" }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(false)
    expect("credentialManagement" in options).toBe(false)
  })

  it("keeps the default policy when credential management is absent", () => {
    // Given
    const input = {}
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(false)
    expect("credentialManagement" in options).toBe(false)
  })

  it("keeps the default policy when credential management is explicitly undefined", () => {
    // Given
    const input = { credentialManagement: undefined }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(false)
    expect("credentialManagement" in options).toBe(false)
  })

  it("enables Claude CLI authority with external credential management", () => {
    // Given
    const input = {
      providers: ["claude"],
      credentialManagement: "external",
      credentialAuthority: { claudeCli: { enabled: true, leadMs: 45_000, retryMs: 90_000 } },
    } satisfies ConnectorOptionsInput
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialAuthority).toEqual({
      claudeCli: { enabled: true, leadMs: 45_000, retryMs: 90_000 },
    })
  })

  it("accepts safe integer boundaries for Claude CLI authority scheduling", () => {
    // Given
    const input = {
      providers: ["claude"],
      credentialManagement: "external",
      credentialAuthority: {
        claudeCli: {
          enabled: true,
          leadMs: Number.MAX_SAFE_INTEGER,
          retryMs: Number.MAX_SAFE_INTEGER,
        },
      },
    }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialAuthority.claudeCli.leadMs).toBe(Number.MAX_SAFE_INTEGER)
    expect(options.credentialAuthority.claudeCli.retryMs).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each([
    ["connector management", { credentialManagement: "connector", providers: ["claude"] }],
    ["omitted management", { providers: ["claude"] }],
    ["disabled Claude", { credentialManagement: "external", providers: ["cursor"] }],
  ])("rejects enabled Claude CLI authority with %s", (_case, policy) => {
    // Given
    const input = { ...policy, credentialAuthority: { claudeCli: { enabled: true } } }
    // When
    const result = ConnectorOptionsSchema.safeParse(input)
    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some(
        (issue) => issue.path.join(".") === "credentialAuthority.claudeCli.enabled",
      ),
    ).toBe(true)
  })

  it("rejects every legacy combination with one exact credential management issue", () => {
    // Given
    const inputs = [
      { credentialManagement: "connector", credentialRefresh: {} },
      { credentialManagement: "connector", writeBackCredentials: false },
      { credentialManagement: "connector", credentialRefresh: {}, writeBackCredentials: false },
      { credentialManagement: "external", credentialRefresh: {} },
      { credentialManagement: "external", writeBackCredentials: false },
      { credentialManagement: "external", credentialRefresh: {}, writeBackCredentials: false },
    ] as const
    // When
    const results = inputs.map((input) => ConnectorOptionsSchema.safeParse(input))
    // Then
    for (const result of results) {
      expect(result.success).toBe(false)
      if (result.success) continue
      expect(result.error.issues).toHaveLength(1)
      expect(result.error.issues[0]).toMatchObject({
        code: "custom",
        message:
          "`credentialManagement` cannot be combined with deprecated `credentialRefresh` or `writeBackCredentials`",
        path: ["credentialManagement"],
      })
    }
  })

  it("rejects an unsupported credential management value", () => {
    // Given
    const input = { credentialManagement: "host" }
    // When
    const result = ConnectorOptionsSchema.safeParse(input)
    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]).toMatchObject({
      code: "invalid_value",
      path: ["credentialManagement"],
      values: ["connector", "external"],
    })
  })

  it("preserves an explicitly empty providers array", () => {
    // Given
    const input = { providers: [] }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.providers).toEqual([])
  })

  it("accepts overrides without sharing defaults", () => {
    // Given
    const input = {
      providers: ["cursor", "command-code", "ollama"],
      snapshotTimeoutMs: 50,
      health: { initialBackoffMs: 5, maximumBackoffMs: 10 },
    }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options).toEqual({
      providers: ["cursor", "command-code", "ollama"],
      snapshotTimeoutMs: 50,
      writeBackCredentials: false,
      credentialRefresh: { mode: "auto", leadMs: 60_000 },
      credentialAuthority: {
        claudeCli: { enabled: false, leadMs: 300_000, retryMs: 300_000 },
      },
      catalogReloadMs: 300_000,
      health: { initialBackoffMs: 5, maximumBackoffMs: 10 },
    })
  })

  it("rejects invalid ranges and unknown keys", () => {
    // Given
    const inputs = [
      { snapshotTimeoutMs: 0 },
      { snapshotTimeoutMs: 2_147_483_648 },
      { catalogReloadMs: 2_147_483_648 },
      { health: { initialBackoffMs: 20, maximumBackoffMs: 10 } },
      { credential: "secret" },
      { providers: ["unknown"] },
      { credentialRefresh: { mode: "sometimes" } },
      { credentialRefresh: { leadMs: -1 } },
      { credentialRefresh: { leadMs: 2_147_483_648 } },
      { credentialRefresh: { extra: true } },
      { credentialAuthority: { claudeCli: { enabled: false, leadMs: -1 } } },
      { credentialAuthority: { claudeCli: { enabled: false, retryMs: 0 } } },
      {
        credentialAuthority: {
          claudeCli: { enabled: false, leadMs: Number.MAX_SAFE_INTEGER + 1 },
        },
      },
      {
        credentialAuthority: {
          claudeCli: { enabled: false, retryMs: Number.MAX_SAFE_INTEGER + 1 },
        },
      },
      { credentialAuthority: { claudeCli: { enabled: false, extra: true } } },
    ]
    // When
    const parses = inputs.map((input) => () => parseConnectorOptions(input))
    // Then
    for (const parse of parses) expect(parse).toThrow()
  })
})
