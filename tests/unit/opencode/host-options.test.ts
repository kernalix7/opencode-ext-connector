import { describe, expect, it } from "bun:test"

import { parseConnectorOptions } from "../../../src/core/options"
import { pickConnectorOptionsInput } from "../../../src/opencode/host-options"

describe("pickConnectorOptionsInput", () => {
  it("keeps known fields and drops host-only keys", () => {
    // Given
    const input = {
      providers: ["cursor"],
      snapshotTimeoutMs: 12_000,
      health: { initialBackoffMs: 2_000, maximumBackoffMs: 8_000 },
      id: "opencode-ext-connector",
      extra: true,
    }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options).toEqual({
      providers: ["cursor"],
      snapshotTimeoutMs: 12_000,
      writeBackCredentials: false,
      catalogReloadMs: 300_000,
      health: { initialBackoffMs: 2_000, maximumBackoffMs: 8_000 },
    })
  })

  it("defaults when the host passes an unrelated object", () => {
    // Given
    const input = { name: "opencode" }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options.snapshotTimeoutMs).toBe(30_000)
    expect(options.health.initialBackoffMs).toBe(1_000)
    expect(options.writeBackCredentials).toBe(false)
  })

  it("honors writeBackCredentials true from the host", () => {
    // Given / When
    const options = parseConnectorOptions(pickConnectorOptionsInput({ writeBackCredentials: true }))
    // Then
    expect(options.writeBackCredentials).toBe(true)
  })
})
