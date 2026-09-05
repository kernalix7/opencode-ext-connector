import { describe, expect, it } from "bun:test"

import { parseConnectorOptions } from "../../../src/core/options"

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
      catalogReloadMs: 300_000,
      health: { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
    })
    expect(Object.isFrozen(options)).toBe(true)
    expect(Object.isFrozen(options.health)).toBe(true)
    expect(Object.isFrozen(options.credentialRefresh)).toBe(true)
  })

  it("accepts a read-only credential refresh policy with a custom lead time", () => {
    // Given
    const input = { credentialRefresh: { mode: "never", leadMs: 1_800_000 } }
    // When
    const options = parseConnectorOptions(input)
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 1_800_000 })
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
    ]
    // When
    const parses = inputs.map((input) => () => parseConnectorOptions(input))
    // Then
    for (const parse of parses) expect(parse).toThrow()
  })
})
