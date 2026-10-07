import { describe, expect, it } from "bun:test"

import { OperationCancelledError } from "../../../../src/core/errors"
import { createSdkFetch } from "../../../../src/http/sdk-fetch"
import { createClaudeCompatibilityFetch } from "../../../../src/providers/claude/compat-request"
import { FakeHttpTransport } from "../../../support/http"

function fixture(
  transport: FakeHttpTransport,
  forceRefreshAccessToken: () => Promise<string | null>,
  readAccessToken: () => Promise<string | null> = async () => "first-token",
) {
  return createClaudeCompatibilityFetch({
    fetch: createSdkFetch(transport),
    readVersion: async () => "9.8.7",
    readAccessToken,
    forceRefreshAccessToken,
  })
}

describe("Claude subscription compatibility transport", () => {
  it("retries an exact 401 once only with a changed credential", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({ status: 401, headers: {}, body: new Uint8Array() })
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"content":[]}'),
    })
    const fetch = fixture(transport, async () => "second-token")
    // When
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: '{"model":"claude-a","messages":[]}',
    })
    // Then
    expect(response.status).toBe(200)
    expect(transport.requests.map((request) => request.headers["authorization"])).toEqual([
      "Bearer first-token",
      "Bearer second-token",
    ])
  })

  it("does not replay 401 when the refreshed token is unchanged", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({ status: 401, headers: {}, body: new Uint8Array() })
    const fetch = fixture(transport, async () => "first-token")
    // When
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "{}",
    })
    // Then
    expect(response.status).toBe(401)
    expect(transport.requests).toHaveLength(1)
  })

  it("returns an over-budget 429 without retrying", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 429,
      headers: { "retry-after": "100" },
      body: new Uint8Array(),
    })
    const fetch = fixture(transport, async () => null)
    // When
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "{}",
    })
    // Then
    expect(response.status).toBe(429)
    expect(transport.requests).toHaveLength(1)
  })

  it("retries the published long-context beta failure through the injected transport", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 400,
      headers: {},
      body: new TextEncoder().encode("long context beta is not yet available"),
    })
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"content":[]}'),
    })
    const fetch = fixture(transport, async () => null)
    // When
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: '{"model":"claude-test-4-6","messages":[]}',
    })
    // Then
    expect(response.status).toBe(200)
    expect(transport.requests).toHaveLength(2)
    expect(transport.requests[1]?.headers["anthropic-beta"]).not.toContain("context-1m-2025-08-07")
  })

  it("prevents a request if cancellation occurs during credential resolution", async () => {
    // Given
    const controller = new AbortController()
    const transport = new FakeHttpTransport()
    const fetch = fixture(
      transport,
      async () => null,
      async () => {
        controller.abort()
        return "first-token"
      },
    )
    // When / Then
    await expect(
      fetch("https://api.anthropic.com/v1/messages", { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OperationCancelledError)
    expect(transport.requests).toHaveLength(0)
  })
})
