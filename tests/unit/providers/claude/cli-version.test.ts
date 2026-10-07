import { expect, it } from "bun:test"
import { createClaudeVersionResolver } from "../../../../src/providers/claude/cli-version"
import { FakeHttpTransport } from "../../../support/http"

it("resolves override lazily without spawning or fetching", async () => {
  // Given
  const transport = new FakeHttpTransport()
  let spawned = 0
  const resolve = createClaudeVersionResolver({
    env: { ANTHROPIC_CLI_VERSION: "2.1.300" },
    transport,
    readInstalledVersion: () => {
      spawned += 1
      return null
    },
  })
  // When
  const version = await resolve(new AbortController().signal)
  // Then
  expect(version).toBe("2.1.300")
  expect(spawned).toBe(0)
  expect(transport.requests).toEqual([])
})

it("resolves published version when no installed CLI exists", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode('{"version":"2.1.301"}'),
  })
  const resolve = createClaudeVersionResolver({
    env: {},
    transport,
    readInstalledVersion: () => null,
  })
  // When
  const version = await resolve(new AbortController().signal)
  // Then
  expect(version).toBe("2.1.301")
  expect(transport.requests[0]?.url).toContain("%40anthropic-ai%2Fclaude-code/latest")
})
