import { describe, expect, it } from "bun:test"

import { refreshClaudeAccessToken } from "../../../../src/providers/claude/refresh"
import { FakeClock } from "../../../support/clock"
import { FakeHttpTransport } from "../../../support/http"

describe("refreshClaudeAccessToken", () => {
  it("posts form-urlencoded refresh and returns new access token", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 3600,
          refresh_token: "new-refresh",
        }),
      ),
    })
    const clock = new FakeClock(1_000)
    // When
    const result = await refreshClaudeAccessToken({
      transport,
      clock,
      refreshToken: "old-refresh",
      signal: new AbortController().signal,
    })
    // Then
    expect(result).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAtMs: 1_000 + 3600 * 1000,
    })
    const request = transport.requests.at(0)
    expect(request?.url).toBe("https://claude.ai/v1/oauth/token")
    expect(request?.headers["content-type"]).toBe("application/x-www-form-urlencoded")
    expect(new TextDecoder().decode(request?.body ?? new Uint8Array())).toContain(
      "grant_type=refresh_token",
    )
  })
})
