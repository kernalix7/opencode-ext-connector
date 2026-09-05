// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { Clock } from "../../core/clock.js"
import type { HttpTransport } from "../../core/http.js"
import type { ClaudeCredentials } from "./credentials.js"

const OAUTH_TOKEN_URL = "https://claude.ai/v1/oauth/token"
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

export type RefreshClaudeOptions = {
  readonly transport: HttpTransport
  readonly clock: Clock
  readonly refreshToken: string
  readonly signal: AbortSignal
}

export type ClaudeRefreshResult =
  | { readonly ok: true; readonly credentials: ClaudeCredentials }
  | {
      readonly ok: false
      readonly kind: "transient" | "terminal"
      readonly retryAfterMs: number | null
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

function retryAfterMs(headers: Readonly<Record<string, string>>): number | null {
  const seconds = Number.parseInt(headers["retry-after"] ?? "", 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : null
}

export async function refreshClaudeAccessTokenResult(
  options: RefreshClaudeOptions,
): Promise<ClaudeRefreshResult> {
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
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.body))
  } catch {
    return {
      ok: false,
      kind: "transient",
      retryAfterMs: retryAfterMs(response.headers),
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, kind: "transient", retryAfterMs: null }
  }
  if (response.status < 200 || response.status >= 300) {
    const oauthError = stringField(parsed, "error")
    const terminal = new Set([
      "invalid_grant",
      "invalid_client",
      "unauthorized_client",
      "unsupported_grant_type",
    ])
    return {
      ok: false,
      kind: oauthError !== null && terminal.has(oauthError) ? "terminal" : "transient",
      retryAfterMs: retryAfterMs(response.headers),
    }
  }
  const accessToken = stringField(parsed, "access_token")
  if (accessToken === null) {
    return { ok: false, kind: "transient", retryAfterMs: null }
  }
  const nowMs = options.clock.nowMs()
  const expiresAt = numberField(parsed, "expires_at")
  const expiresIn = numberField(parsed, "expires_in")
  const expiresAtMs =
    expiresAt !== null && expiresAt > nowMs
      ? Math.trunc(expiresAt)
      : Math.trunc(nowMs + (expiresIn ?? 36_000) * 1000)
  return {
    ok: true,
    credentials: {
      accessToken,
      refreshToken: stringField(parsed, "refresh_token") ?? options.refreshToken,
      expiresAtMs,
    },
  }
}

export async function refreshClaudeAccessToken(
  options: RefreshClaudeOptions,
): Promise<ClaudeCredentials | null> {
  const result = await refreshClaudeAccessTokenResult(options)
  return result.ok ? result.credentials : null
}
