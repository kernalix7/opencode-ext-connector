import { describe, expect, it } from "bun:test"

import { parseConnectorOptions } from "../../../src/core/options"
import { pickConnectorOptionsInput } from "../../../src/opencode/host-options"

describe("pickConnectorOptionsInput", () => {
  it("keeps known fields and drops host-only keys", () => {
    // Given
    const input = {
      snapshotTimeoutMs: 12_000,
      health: { initialBackoffMs: 2_000, maximumBackoffMs: 8_000 },
      id: "opencode-ext-connector",
      extra: true,
    }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options).toEqual({
      snapshotTimeoutMs: 12_000,
      writeBackCredentials: true,
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
    expect(options.writeBackCredentials).toBe(true)
  })

  it("honors writeBackCredentials false from the host", () => {
    // Given / When
    const options = parseConnectorOptions(
      pickConnectorOptionsInput({ writeBackCredentials: false }),
    )
    // Then
    expect(options.writeBackCredentials).toBe(false)
  })
})
