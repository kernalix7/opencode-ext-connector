import { describe, expect, it } from "bun:test"

import { createOllamaSessionAuth } from "../../../src/opencode/v1-session-auth"

describe("Custom provider session auth", () => {
  it("does not expose loaders for providers absent from OpenCode's catalog database", () => {
    // Given
    const hooks = [createOllamaSessionAuth()]

    // When
    const loaders = hooks.map((hook) => hook.loader)

    // Then
    expect(loaders).toEqual([undefined])
  })
})
