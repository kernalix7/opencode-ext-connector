import { expect, it } from "bun:test"

import { parseConnectorOptions } from "../../../src/core/options"

it("defaults to the three supported providers and preserves bounded timing", () => {
  // Given / When
  const options = parseConnectorOptions({})
  // Then
  expect(options.providers).toEqual(["claude", "command-code", "ollama"])
  expect(options.snapshotTimeoutMs).toBe(30_000)
  expect(options.health).toEqual({ initialBackoffMs: 1_000, maximumBackoffMs: 60_000 })
})

it.each([
  "credentialRole",
  "credentialManagement",
  "credentialAuthority",
  "credentialRefresh",
  "writeBackCredentials",
  "xaiOAuth",
])("rejects retired %s before constructing resources", (field) => {
  // Given / When
  const parse = () => parseConnectorOptions({ [field]: true })
  // Then
  expect(parse).toThrow(`${field} was retired`)
})

it("rejects Cursor and unknown providers instead of silently dropping them", () => {
  // Given / When
  const parse = () => parseConnectorOptions({ providers: ["cursor"] })
  // Then
  expect(parse).toThrow()
})

it("honors explicit empty providers and rejects invalid health bounds", () => {
  // Given / When
  const empty = parseConnectorOptions({ providers: [] })
  const invalid = () =>
    parseConnectorOptions({ health: { initialBackoffMs: 30, maximumBackoffMs: 20 } })
  // Then
  expect(empty.providers).toEqual([])
  expect(invalid).toThrow("initial backoff exceeds maximum")
})
