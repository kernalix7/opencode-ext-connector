import { describe, expect, it } from "bun:test"

import { ConnectorOptionsSchema, parseConnectorOptions } from "../../../src/core/options"
import { pickConnectorOptionsInput } from "../../../src/opencode/host-options"

describe("credential role host options", () => {
  it.each([
    ["owner", true],
    ["reader", false],
  ])("preserves the %s role through host sanitization", (credentialRole, enabled) => {
    // Given
    const input = { credentialRole, extra: true }

    // When
    const picked = pickConnectorOptionsInput(input)
    const options = parseConnectorOptions(picked)

    // Then
    expect(picked).toMatchObject({ credentialRole })
    expect("extra" in picked).toBe(false)
    expect(options.credentialAuthority.claudeCli.enabled).toBe(enabled)
    expect(options.credentialRefresh.mode).toBe("never")
    expect(options.writeBackCredentials).toBe(false)
  })

  it("drops an explicitly undefined credential role", () => {
    // Given / When
    const picked = pickConnectorOptionsInput({ credentialRole: undefined })
    const options = parseConnectorOptions(picked)

    // Then
    expect("credentialRole" in picked).toBe(false)
    expect(options.credentialRefresh.mode).toBe("auto")
    expect(options.credentialAuthority.claudeCli.enabled).toBe(false)
  })

  it("preserves an unsupported role for strict validation", () => {
    // Given / When
    const picked = pickConnectorOptionsInput({ credentialRole: "host", extra: true })
    const result = ConnectorOptionsSchema.safeParse(picked)

    // Then
    expect(picked).toMatchObject({ credentialRole: "host" })
    expect("extra" in picked).toBe(false)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]).toMatchObject({
      code: "invalid_value",
      path: ["credentialRole"],
    })
  })

  it("preserves low-level options so role conflicts remain visible", () => {
    // Given
    const input = {
      credentialRole: "owner",
      credentialManagement: "external",
      credentialAuthority: { claudeCli: { enabled: true } },
    }

    // When
    const result = ConnectorOptionsSchema.safeParse(pickConnectorOptionsInput(input))

    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((issue) => issue.path[0] === "credentialRole")).toBe(true)
  })
})
