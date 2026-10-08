import { describe, expect, it } from "bun:test"

import { ConnectorOptionsSchema, parseConnectorOptions } from "../../../src/core/options"
import { pickConnectorOptionsInput } from "../../../src/opencode/host-options"

describe("xAI OAuth host options", () => {
  it.each(["authority", "consumer"] as const)("normalizes %s through host extraction", (mode) => {
    // Given
    const input = { providers: [], credentialRole: "reader", xaiOAuth: { mode }, extra: true }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options).toMatchObject({
      providers: [],
      xaiOAuth: { mode },
      credentialRefresh: { mode: "never", leadMs: 60_000 },
    })
    expect("extra" in options).toBe(false)
  })

  it("normalizes omitted xAI OAuth to null through host extraction", () => {
    // Given / When
    const options = parseConnectorOptions(pickConnectorOptionsInput({ name: "host" }))
    // Then
    expect(options).toMatchObject({ xaiOAuth: null })
  })

  it.each([null, {}, { mode: "unknown" }, { mode: null }, { mode: "authority", extra: true }])(
    "preserves malformed xAI OAuth for strict boundary rejection: %j",
    (xaiOAuth) => {
      // Given / When
      const result = ConnectorOptionsSchema.safeParse(pickConnectorOptionsInput({ xaiOAuth }))
      // Then
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.error.issues.some((issue) => issue.path[0] === "xaiOAuth")).toBe(true)
    },
  )
})
