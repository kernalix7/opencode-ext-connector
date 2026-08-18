import { describe, expect, it } from "bun:test"
import {
  ModelIdSchema,
  ProviderIdSchema,
  parseModelId,
  parseProviderId,
} from "../../../src/core/ids"

describe("provider and model IDs", () => {
  it("accepts lowercase provider slugs", () => {
    // Given
    const input = "provider-one"
    // When
    const result = parseProviderId(input)
    // Then
    expect(String(result)).toBe(input)
  })

  it("rejects malformed provider slugs", () => {
    // Given
    const inputs = ["Provider", "provider--one", " provider", "provider-"]
    // When
    const results = inputs.map((input) => ProviderIdSchema.safeParse(input).success)
    // Then
    expect(results).toEqual([false, false, false, false])
  })

  it("preserves valid model IDs", () => {
    // Given
    const input = "Model/V2:latest"
    // When
    const result = parseModelId(input)
    // Then
    expect(String(result)).toBe(input)
  })

  it("rejects model IDs with boundary whitespace or controls", () => {
    // Given
    const inputs = [" model", "model ", "model\nnext", ""]
    // When
    const results = inputs.map((input) => ModelIdSchema.safeParse(input).success)
    // Then
    expect(results).toEqual([false, false, false, false])
  })
})
