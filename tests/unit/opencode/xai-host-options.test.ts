import { describe, expect, it } from "bun:test"

import { ConnectorOptionsSchema, parseConnectorOptions } from "../../../src/core/options"
import { pickConnectorOptionsInput } from "../../../src/opencode/host-options"

describe("xAI OAuth host options", () => {
  it("passes raw xAI OAuth input through for strict parsing", () => {
    // Given
    const xaiOAuth = { mode: "consumer", extra: true }

    // When
    const picked = pickConnectorOptionsInput({ xaiOAuth, hostOnly: true })
    const result = ConnectorOptionsSchema.safeParse(picked)

    // Then
    expect(picked).toMatchObject({ xaiOAuth })
    expect(result.success).toBe(false)
  })

  it("preserves a valid mode independently of Claude credential ownership", () => {
    // Given / When
    const options = parseConnectorOptions(
      pickConnectorOptionsInput({ credentialRole: "owner", xaiOAuth: { mode: "authority" } }),
    )

    // Then
    expect(options.xaiOAuth).toEqual({ mode: "authority" })
    expect(options.credentialAuthority.claudeCli.enabled).toBe(true)
  })
})
