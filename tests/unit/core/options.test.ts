import { describe, expect, it } from "bun:test"

import { parseConnectorOptions } from "../../../src/core/options"

describe("connector options", () => {
  it("applies immutable defaults", () => {
    // Given
    const input = {}
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options).toEqual({
      snapshotTimeoutMs: 30_000,
      writeBackCredentials: true,
      catalogReloadMs: 300_000,
      health: { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
    })
    expect(Object.isFrozen(options)).toBe(true)
    expect(Object.isFrozen(options.health)).toBe(true)
  })

  it("accepts overrides without sharing defaults", () => {
    // Given
    const input = { snapshotTimeoutMs: 50, health: { initialBackoffMs: 5, maximumBackoffMs: 10 } }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options).toEqual({
      snapshotTimeoutMs: 50,
      writeBackCredentials: true,
      catalogReloadMs: 300_000,
      health: { initialBackoffMs: 5, maximumBackoffMs: 10 },
    })
  })

  it("rejects invalid ranges and unknown keys", () => {
    // Given
    const inputs = [
      { snapshotTimeoutMs: 0 },
      { health: { initialBackoffMs: 20, maximumBackoffMs: 10 } },
      { credential: "secret" },
    ]
    // When
    const parses = inputs.map((input) => () => parseConnectorOptions(input))
    // Then
    for (const parse of parses) expect(parse).toThrow()
  })
})
