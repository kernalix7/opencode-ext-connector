// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { Clock } from "../../core/clock"
import type { HttpTransport } from "../../core/http"
import type { ClaudeCredentials } from "./credentials"

const OAUTH_TOKEN_URL = "https://claude.ai/v1/oauth/token"
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

export type RefreshClaudeOptions = {
  readonly transport: HttpTransport
  readonly clock: Clock
  readonly refreshToken: string
  readonly signal: AbortSignal
}

function stringField(value: object, key: string): string | null {
  if (!(key in value)) {
    return null
  }
  const field = Reflect.get(value, key)
  return typeof field === "string" && field.length > 0 ? field : null
}

function numberField(value: object, key: string): number | null {
  if (!(key in value)) {
    return null
  }
  const field = Reflect.get(value, key)
  return typeof field === "number" && Number.isFinite(field) ? field : null
}

export async function refreshClaudeAccessToken(
  options: RefreshClaudeOptions,
): Promise<ClaudeCredentials | null> {
  const body = new TextEncoder().encode(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OAUTH_CLIENT_ID,
      refresh_token: options.refreshToken,
    }).toString(),
  )
  const response = await options.transport.request(
    {
      method: "POST",
      url: OAUTH_TOKEN_URL,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    options.signal,
  )
  if (response.status >= 400) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.body))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null
  }
  const accessToken = stringField(parsed, "access_token")
  if (accessToken === null) {
    return null
  }
  const nowMs = options.clock.nowMs()
  const expiresAt = numberField(parsed, "expires_at")
  const expiresIn = numberField(parsed, "expires_in")
  const expiresAtMs =
    expiresAt !== null && expiresAt > nowMs
      ? Math.trunc(expiresAt)
      : Math.trunc(nowMs + (expiresIn ?? 36_000) * 1000)
  return {
    accessToken,
    refreshToken: stringField(parsed, "refresh_token") ?? options.refreshToken,
    expiresAtMs,
  }
}
