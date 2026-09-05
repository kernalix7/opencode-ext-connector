import { describe, expect, it } from "bun:test"

import { createClaudeTokenManager } from "../../../../src/providers/claude/auth"
import { FakeClock } from "../../../support/clock"
import { FakeHttpTransport } from "../../../support/http"

describe("createClaudeTokenManager", () => {
  it("keeps rotated credentials as the source for subsequent reads", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 3_600,
        }),
      ),
    })
    const manager = createClaudeTokenManager({
      env: {},
      clock: new FakeClock(120_000),
      transport,
      lookup: {
        readKeychain: async () =>
          JSON.stringify({
            accessToken: "stored-access",
            refreshToken: "stored-refresh",
            expiresAt: 0,
          }),
      },
    })
    const signal = new AbortController().signal
    await manager.readAccessToken(signal)

    // When
    const token = await manager.readAccessToken(signal)

    // Then
    expect(token).toBe("rotated-access")
    expect(transport.requests).toHaveLength(1)
  })

  it("passes rotated credentials to an injected writeback", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 3_600,
        }),
      ),
    })
    const written: string[] = []
    const manager = createClaudeTokenManager({
      env: {},
      clock: new FakeClock(120_000),
      transport,
      lookup: {
        readKeychain: async () =>
          JSON.stringify({
            accessToken: "stored-access",
            refreshToken: "stored-refresh",
            expiresAt: 0,
          }),
      },
      writeBack: async (credentials) => {
        written.push(credentials.accessToken)
      },
    })

    // When
    await manager.readAccessToken(new AbortController().signal)

    // Then
    expect(written).toEqual(["rotated-access"])
  })

  it("refreshes ahead of expiry by the configured lead time", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({ access_token: "rotated-access", expires_in: 3_600 }),
      ),
    })
    const manager = createClaudeTokenManager({
      env: {},
      clock: new FakeClock(0),
      transport,
      refresh: { mode: "auto", leadMs: 30 * 60_000 },
      lookup: {
        readKeychain: async () =>
          JSON.stringify({
            accessToken: "stored-access",
            refreshToken: "stored-refresh",
            expiresAt: 20 * 60_000,
          }),
      },
    })

    // When
    const token = await manager.readAccessToken(new AbortController().signal)

    // Then
    expect(token).toBe("rotated-access")
    expect(transport.requests).toHaveLength(1)
  })

  it("never calls the OAuth endpoint when refresh mode is never", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const manager = createClaudeTokenManager({
      env: {},
      clock: new FakeClock(120_000),
      transport,
      refresh: { mode: "never", leadMs: 60_000 },
      lookup: {
        readKeychain: async () =>
          JSON.stringify({
            accessToken: "expired-access",
            refreshToken: "stored-refresh",
            expiresAt: 0,
          }),
      },
    })
    const signal = new AbortController().signal

    // When
    const token = await manager.readAccessToken(signal)
    const forced = await manager.forceRefreshAccessToken(signal)

    // Then
    expect(token).toBe("expired-access")
    expect(forced).toBeNull()
    expect(transport.requests).toHaveLength(0)
  })

  it("adopts externally synced credentials on forced refresh in never mode", async () => {
    // Given
    const transport = new FakeHttpTransport()
    let stored = "host-access-1"
    const manager = createClaudeTokenManager({
      env: {},
      clock: new FakeClock(120_000),
      transport,
      refresh: { mode: "never", leadMs: 60_000 },
      lookup: {
        readKeychain: async () =>
          JSON.stringify({
            accessToken: stored,
            refreshToken: "host-refresh",
            expiresAt: 0,
          }),
      },
    })
    const signal = new AbortController().signal
    await manager.readAccessToken(signal)

    // When
    stored = "host-access-2"
    const forced = await manager.forceRefreshAccessToken(signal)

    // Then
    expect(forced).toBe("host-access-2")
    expect(transport.requests).toHaveLength(0)
  })
})
