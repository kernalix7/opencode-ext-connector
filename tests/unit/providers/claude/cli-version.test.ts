import { describe, expect, it } from "bun:test"

import {
  createClaudeVersionResolver,
  parseClaudeCliVersion,
} from "../../../../src/providers/claude/cli-version"
import { FakeHttpTransport } from "../../../support/http"

const signal = new AbortController().signal

describe("createClaudeVersionResolver", () => {
  it("parses installed Claude CLI version output", () => {
    // Given / When / Then
    expect(parseClaudeCliVersion("2.1.217 (Claude Code)")).toBe("2.1.217")
  })

  it("prefers ANTHROPIC_CLI_VERSION without spawning or fetching", async () => {
    // Given
    const transport = new FakeHttpTransport()
    let spawned = 0
    const resolve = createClaudeVersionResolver({
      env: { ANTHROPIC_CLI_VERSION: "9.9.9 (Claude Code)" },
      transport,
      readInstalledVersion: () => {
        spawned += 1
        return "1.0.0"
      },
    })

    // When
    const version = await resolve(signal)

    // Then
    expect(version).toBe("9.9.9")
    expect(spawned).toBe(0)
    expect(transport.requests).toHaveLength(0)
  })

  it("uses an installed claude binary before the registry", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const resolve = createClaudeVersionResolver({
      env: {},
      transport,
      readInstalledVersion: () => "2.1.217",
    })

    // When
    const version = await resolve(signal)

    // Then
    expect(version).toBe("2.1.217")
    expect(transport.requests).toHaveLength(0)
  })

  it("falls back to the latest published @anthropic-ai/claude-code without a binary", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(JSON.stringify({ version: "2.1.261" })),
    })
    const resolve = createClaudeVersionResolver({
      env: {},
      transport,
      readInstalledVersion: () => null,
    })

    // When
    const version = await resolve(signal)

    // Then
    expect(version).toBe("2.1.261")
    expect(transport.requests[0]?.url).toBe(
      "https://registry.npmjs.org/%40anthropic-ai%2Fclaude-code/latest",
    )
  })

  it("returns null when every source is unavailable", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueError(new Error("offline"))
    const resolve = createClaudeVersionResolver({
      env: {},
      transport,
      readInstalledVersion: () => null,
    })

    // When / Then
    expect(await resolve(signal)).toBeNull()
  })

  it("does not spawn a real claude binary when PATH is empty", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(JSON.stringify({ version: "2.1.261" })),
    })
    const resolve = createClaudeVersionResolver({ env: { PATH: "" }, transport })

    // When / Then
    expect(await resolve(signal)).toBe("2.1.261")
  })
})
