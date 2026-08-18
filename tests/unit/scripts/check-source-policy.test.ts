import { describe, expect, it } from "bun:test"

import { inspectSource } from "../../../scripts/check-source-policy"

describe("inspectSource", () => {
  it("rejects explicit any types", () => {
    // Given
    const sourceText = "const value: any = 1"

    // When
    const violations = inspectSource("src/value.ts", sourceText)

    // Then
    expect(violations.map(({ rule }) => rule)).toEqual(["explicit-any"])
  })

  it("rejects type assertions except const assertions", () => {
    // Given
    const sourceText = "const value = input as string\nconst constant = { key: 1 } as const"

    // When
    const violations = inspectSource("src/value.ts", sourceText)

    // Then
    expect(violations.map(({ rule }) => rule)).toEqual(["type-assertion"])
  })

  it("rejects non-null assertions", () => {
    // Given
    const sourceText = "const value = input!.key"

    // When
    const violations = inspectSource("src/value.ts", sourceText)

    // Then
    expect(violations.map(({ rule }) => rule)).toEqual(["non-null-assertion"])
  })

  it("rejects TypeScript suppression comments", () => {
    // Given
    const sourceText = "// @ts-expect-error\nconst value = missing"

    // When
    const violations = inspectSource("src/value.ts", sourceText)

    // Then
    expect(violations.map(({ rule }) => rule)).toEqual(["ts-suppression"])
  })

  it("rejects enum declarations", () => {
    // Given
    const sourceText = "enum State { Ready }"

    // When
    const violations = inspectSource("src/value.ts", sourceText)

    // Then
    expect(violations.map(({ rule }) => rule)).toEqual(["enum"])
  })

  it("rejects console calls outside the logger boundary", () => {
    // Given
    const sourceText = 'console.info("ready")'

    // When
    const violations = inspectSource("src/value.ts", sourceText)

    // Then
    expect(violations.map(({ rule }) => rule)).toEqual(["console"])
  })

  it("allows console calls in the logger boundary", () => {
    // Given
    const sourceText = 'console.info("ready")'

    // When
    const violations = inspectSource("src/logging/logger.ts", sourceText)

    // Then
    expect(violations).toEqual([])
  })

  it("rejects imports between sibling providers", () => {
    // Given
    const sourceText = 'import { adapter } from "../provider-b/adapter"'

    // When
    const violations = inspectSource("src/providers/provider-a/index.ts", sourceText)

    // Then
    expect(violations.map(({ rule }) => rule)).toEqual(["provider-sibling-import"])
  })

  it("rejects OpenCode v2 imports outside the beta API boundary", () => {
    // Given
    const sourceText = 'import type { Plugin } from "@opencode-ai/plugin/v2/promise"'

    // When
    const violations = inspectSource("src/opencode/client.ts", sourceText)

    // Then
    expect(violations.map(({ rule }) => rule)).toEqual(["opencode-beta-import"])
  })

  it("allows OpenCode v2 imports in the beta API boundary", () => {
    // Given
    const sourceText = 'import type { Plugin } from "@opencode-ai/plugin/v2/promise"'

    // When
    const violations = inspectSource("src/opencode/beta-api.ts", sourceText)

    // Then
    expect(violations).toEqual([])
  })
})
