import { describe, expect, it } from "bun:test"

import { ConnectorOptionsSchema, parseConnectorOptions } from "../../../src/core/options"

describe("xAI OAuth connector options", () => {
  it("keeps xAI OAuth off when the option is omitted", () => {
    // Given / When
    const options = parseConnectorOptions({ credentialRole: "reader" })

    // Then
    expect(options.xaiOAuth).toBeNull()
    expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 60_000 })
  })

  it.each(["authority", "consumer"] as const)("accepts independent %s mode", (mode) => {
    // Given / When
    const options = parseConnectorOptions({ credentialRole: "reader", xaiOAuth: { mode } })

    // Then
    expect(options.xaiOAuth).toEqual({ mode })
    expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 60_000 })
  })

  it.each([null, {}, { mode: "off" }, { mode: "consumer", extra: true }])(
    "rejects malformed xAI OAuth input %#",
    (xaiOAuth) => {
      // Given / When
      const result = ConnectorOptionsSchema.safeParse({ xaiOAuth })

      // Then
      expect(result.success).toBe(false)
    },
  )
})
