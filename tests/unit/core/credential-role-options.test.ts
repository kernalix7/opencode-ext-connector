import { describe, expect, it } from "bun:test"

import { ConnectorOptionsSchema, parseConnectorOptions } from "../../../src/core/options"

describe("credential role options", () => {
  it.each([
    ["owner", true],
    ["reader", false],
  ])("maps %s to external credential handling with CLI authority %s", (credentialRole, enabled) => {
    // Given / When
    const options = parseConnectorOptions({ credentialRole })

    // Then
    expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(false)
    expect(options.credentialAuthority.claudeCli).toEqual({
      enabled,
      leadMs: 300_000,
      retryMs: 300_000,
    })
    expect("credentialRole" in options).toBe(false)
  })

  it("preserves default behavior when the credential role is explicitly undefined", () => {
    // Given / When
    const options = parseConnectorOptions({ credentialRole: undefined })

    // Then
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(false)
    expect(options.credentialAuthority.claudeCli.enabled).toBe(false)
  })

  it.each([
    ["credential management", { credentialRole: "owner", credentialManagement: "external" }],
    [
      "credential authority",
      {
        credentialRole: "owner",
        credentialAuthority: { claudeCli: { enabled: false } },
      },
    ],
    ["legacy refresh", { credentialRole: "reader", credentialRefresh: {} }],
    ["legacy writeback", { credentialRole: "reader", writeBackCredentials: false }],
  ])("rejects a role combined with %s", (_case, input) => {
    // Given / When
    const result = ConnectorOptionsSchema.safeParse(input)

    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues).toContainEqual({
      code: "custom",
      message:
        "`credentialRole` cannot be combined with `credentialManagement`, `credentialAuthority`, `credentialRefresh`, or `writeBackCredentials`",
      path: ["credentialRole"],
    })
  })

  it("requires the Claude provider for the owner role", () => {
    // Given / When
    const result = ConnectorOptionsSchema.safeParse({
      providers: ["cursor", "command-code", "ollama"],
      credentialRole: "owner",
    })

    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues).toContainEqual({
      code: "custom",
      message: "Credential owner role requires the Claude provider",
      path: ["credentialRole"],
    })
  })

  it("allows the reader role without the Claude provider", () => {
    // Given / When
    const options = parseConnectorOptions({
      providers: ["cursor", "command-code", "ollama"],
      credentialRole: "reader",
    })

    // Then
    expect(options.providers).toEqual(["cursor", "command-code", "ollama"])
    expect(options.credentialAuthority.claudeCli.enabled).toBe(false)
  })

  it("rejects an unsupported credential role", () => {
    // Given / When
    const result = ConnectorOptionsSchema.safeParse({ credentialRole: "host" })

    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]).toMatchObject({
      code: "invalid_value",
      path: ["credentialRole"],
      values: ["owner", "reader"],
    })
  })
})
