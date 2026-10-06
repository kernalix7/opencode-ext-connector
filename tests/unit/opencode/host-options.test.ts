import { describe, expect, it } from "bun:test"

import { ConnectorOptionsSchema, parseConnectorOptions } from "../../../src/core/options"
import { pickConnectorOptionsInput, pickOllamaBaseURL } from "../../../src/opencode/host-options"

describe("official connector host options", () => {
  it("retains connector fields without leaking host-only configuration", () => {
    // Given
    const input = {
      providers: ["claude"],
      snapshotTimeoutMs: 12_000,
      health: { initialBackoffMs: 2_000, maximumBackoffMs: 8_000 },
      id: "host",
      extra: true,
    }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options).toEqual({
      providers: ["claude"],
      snapshotTimeoutMs: 12_000,
      catalogReloadMs: 300_000,
      health: { initialBackoffMs: 2_000, maximumBackoffMs: 8_000 },
    })
  })

  it.each([
    "credentialRole",
    "credentialManagement",
    "credentialAuthority",
    "credentialRefresh",
    "writeBackCredentials",
    "xaiOAuth",
  ])("preserves the retired %s field for explicit rejection", (field) => {
    // Given
    const input = { [field]: false, extra: true }
    // When
    const result = ConnectorOptionsSchema.safeParse(pickConnectorOptionsInput(input))
    // Then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Retired option was accepted")
    expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true)
  })

  it("rejects a selected Cursor provider rather than silently dropping it", () => {
    // Given
    const input = { providers: ["cursor"] }
    // When
    const result = ConnectorOptionsSchema.safeParse(pickConnectorOptionsInput(input))
    // Then
    expect(result.success).toBe(false)
  })

  it("preserves malformed numeric options for boundary validation", () => {
    // Given
    const input = {
      snapshotTimeoutMs: "soon",
      health: { initialBackoffMs: 9_000, maximumBackoffMs: 1_000 },
    }
    // When
    const result = ConnectorOptionsSchema.safeParse(pickConnectorOptionsInput(input))
    // Then
    expect(result.success).toBe(false)
  })

  it("defaults when only unrelated host fields are present", () => {
    // Given
    const input = { name: "host" }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options.providers).toEqual(["claude", "command-code", "ollama"])
    expect(options.snapshotTimeoutMs).toBe(30_000)
    expect(options.health.initialBackoffMs).toBe(1_000)
  })
})

describe("pickOllamaBaseURL", () => {
  it("extracts the flat daemon URL independently of core options", () => {
    // Given
    const input = { ollamaBaseURL: "https://daemon.example.test/ollama", providers: ["ollama"] }
    // When
    const baseURL = pickOllamaBaseURL(input)
    // Then
    expect(baseURL).toBe(input.ollamaBaseURL)
    expect("ollamaBaseURL" in pickConnectorOptionsInput(input)).toBe(false)
  })

  it("preserves malformed daemon values for the provider boundary", () => {
    // Given / When
    const baseURL = pickOllamaBaseURL({ ollamaBaseURL: 11434 })
    // Then
    expect(baseURL).toBe(11434)
  })
})
