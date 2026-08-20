import { describe, expect, it } from "bun:test"

import { createAnthropicCliAuth } from "../../../src/opencode/v1-anthropic-auth"
import { transformClaudeBody } from "../../../src/providers/claude/compat-transform"

describe("createAnthropicCliAuth", () => {
  it("applies Claude Code identity, billing, and tool-name transforms", () => {
    // Given
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      system: [{ type: "text", text: "project instructions" }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Please read package.json" }],
        },
      ],
      tools: [{ name: "read", input_schema: { type: "object" } }],
    })
    // When
    const transformed = transformClaudeBody(body, "2.1.217")
    // Then
    expect(typeof transformed).toBe("string")
    expect(transformed).toContain("x-anthropic-billing-header")
    expect(transformed).toContain("Anthropic's official CLI")
    expect(transformed).toContain('"name":"mcp_Read"')
    expect(transformed).toContain("project instructions")
  })

  it("authorizes Anthropic oauth from Claude Code credentials", async () => {
    // Given
    const auth = createAnthropicCliAuth({
      readCredentials: async () => ({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAtMs: 1_700_000_000_000,
      }),
      readAccessToken: async () => "access-1",
      forceRefreshAccessToken: async () => "access-2",
      cliVersion: "2.1.217",
    })
    const method = auth.methods[0]
    // When
    if (method === undefined || method.type !== "oauth") {
      throw new Error("expected oauth method")
    }
    const result = await method.authorize()
    if (result.method !== "auto") {
      throw new Error("expected auto oauth")
    }
    const callback = await result.callback()
    // Then
    expect(auth.provider).toBe("anthropic")
    expect(method.label).toBe("Claude Code subscription")
    expect(callback).toEqual({
      type: "success",
      provider: "anthropic",
      access: "access-1",
      refresh: "refresh-1",
      expires: 1_700_000_000_000,
    })
  })

  it("fails authorize when Claude Code credentials are missing", async () => {
    // Given
    const auth = createAnthropicCliAuth({
      readCredentials: async () => null,
      readAccessToken: async () => null,
      forceRefreshAccessToken: async () => null,
      cliVersion: "2.1.217",
    })
    const method = auth.methods[0]
    // When
    if (method === undefined || method.type !== "oauth") {
      throw new Error("expected oauth method")
    }
    const result = await method.authorize()
    if (result.method !== "auto") {
      throw new Error("expected auto oauth")
    }
    const callback = await result.callback()
    // Then
    expect(callback).toEqual({ type: "failed" })
  })
})
