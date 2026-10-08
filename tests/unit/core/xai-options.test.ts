import { describe, expect, it } from "bun:test"

import { ConnectorOptionsSchema, parseConnectorOptions } from "../../../src/core/options"

describe("xAI OAuth connector options", () => {
  it.each([{}, { xaiOAuth: undefined }, { providers: [], credentialRole: "reader" }])(
    "normalizes disabled xAI OAuth to null when omitted: %j",
    (input) => {
      // Given / When
      const options = parseConnectorOptions(input)
      // Then
      expect(options).toMatchObject({ xaiOAuth: null })
    },
  )

  it.each(["authority", "consumer"] as const)("preserves independent %s mode", (mode) => {
    // Given / When
    const options = parseConnectorOptions({ xaiOAuth: { mode } })
    // Then
    expect(options).toMatchObject({
      xaiOAuth: { mode },
      providers: ["claude", "command-code", "ollama"],
      credentialRefresh: { mode: "auto", leadMs: 60_000 },
      writeBackCredentials: false,
    })
    expect(Object.isFrozen(options.xaiOAuth)).toBe(true)
  })

  for (const mode of ["authority", "consumer"] as const) {
    it.each(["reader", "owner"] as const)(`accepts ${mode} with Claude %s role`, (role) => {
      // Given / When
      const options = parseConnectorOptions({ credentialRole: role, xaiOAuth: { mode } })
      // Then
      expect(options).toMatchObject({
        xaiOAuth: { mode },
        credentialRefresh: { mode: "never", leadMs: 60_000 },
        writeBackCredentials: false,
        credentialAuthority: { claudeCli: { enabled: role === "owner" } },
      })
    })

    it.each([{}, { credentialRole: "reader" }, { credentialManagement: "connector" }])(
      `keeps ${mode} independent of an empty provider allow-list: %j`,
      (policy) => {
        // Given / When
        const options = parseConnectorOptions({ providers: [], ...policy, xaiOAuth: { mode } })
        // Then
        expect(options).toMatchObject({ providers: [], xaiOAuth: { mode } })
      },
    )

    it.each([
      { providers: [], credentialRole: "owner" },
      { credentialRole: "reader", writeBackCredentials: false },
      { credentialManagement: "external", credentialRefresh: {} },
      {
        providers: [],
        credentialManagement: "external",
        credentialAuthority: { claudeCli: { enabled: true } },
      },
    ])(`retains Claude constraints with ${mode}: %j`, (policy) => {
      // Given / When
      const result = ConnectorOptionsSchema.safeParse({ ...policy, xaiOAuth: { mode } })
      // Then
      expect(result.success).toBe(false)
    })
  }

  it.each(
    [
      null,
      false,
      "consumer",
      [],
      {},
      { mode: "off" },
      { mode: null },
      { mode: undefined },
      { mode: "consumer", extra: true },
    ].map((xaiOAuth) => ({ xaiOAuth })),
  )("rejects malformed xAI OAuth input: %j", ({ xaiOAuth }) => {
    // Given / When
    const result = ConnectorOptionsSchema.safeParse({ xaiOAuth })
    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((issue) => issue.path[0] === "xaiOAuth")).toBe(true)
  })

  it("rejects xAI in the provider allow-list when OAuth is enabled", () => {
    // Given / When
    const result = ConnectorOptionsSchema.safeParse({
      providers: ["xai"],
      xaiOAuth: { mode: "consumer" },
    })
    // Then
    expect(result.success).toBe(false)
  })
})
