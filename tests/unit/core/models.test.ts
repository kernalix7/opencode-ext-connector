import { describe, expect, it } from "bun:test"

import { parseAdapterModel, parseProviderSnapshot } from "../../../src/core/models"

describe("provider models", () => {
  it("parses and freezes normalized models", () => {
    // Given
    const input = { id: "model-one" }
    // When
    const model = parseAdapterModel(input)
    // Then
    expect(String(model.id)).toBe("model-one")
    expect(Object.isFrozen(model)).toBe(true)
  })

  it("parses every provider snapshot state", () => {
    // Given
    const inputs = [
      { status: "ready", providerId: "one", models: [{ id: "a" }] },
      { status: "stale", providerId: "two", models: [], reason: "transport-error" },
      { status: "unavailable", providerId: "three", reason: "process-error" },
    ]
    // When
    const snapshots = inputs.map(parseProviderSnapshot)
    // Then
    expect(snapshots.map(({ status }) => status)).toEqual(["ready", "stale", "unavailable"])
  })

  it("rejects duplicate model IDs", () => {
    // Given
    const input = { status: "ready", providerId: "one", models: [{ id: "a" }, { id: "a" }] }
    // When
    const parse = () => parseProviderSnapshot(input)
    // Then
    expect(parse).toThrow()
  })

  it("rejects unknown fields", () => {
    // Given
    const input = { status: "unavailable", providerId: "one", reason: "adapter-error", models: [] }
    // When
    const parse = () => parseProviderSnapshot(input)
    // Then
    expect(parse).toThrow()
  })
})
