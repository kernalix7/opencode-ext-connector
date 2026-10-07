// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.
import { z } from "zod"
import type { Clock } from "../../core/clock.js"
import type { HttpTransport } from "../../core/http.js"
import type { ClaudeCredentials } from "./credentials.js"

const responseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().finite().positive().optional(),
  expires_at: z.number().finite().positive().optional(),
})
const errorSchema = z.object({ error: z.string().optional() })
export type ClaudeRefreshResult =
  | { readonly ok: true; readonly credentials: ClaudeCredentials }
  | {
      readonly ok: false
      readonly kind: "transient" | "terminal"
      readonly retryAfterMs: number | null
    }

export async function refreshClaudeAccessTokenResult(options: {
  readonly transport: HttpTransport
  readonly clock: Clock
  readonly refreshToken: string
  readonly signal: AbortSignal
}): Promise<ClaudeRefreshResult> {
  const response = await options.transport.request(
    {
      method: "POST",
      url: "https://claude.ai/v1/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new TextEncoder().encode(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
          refresh_token: options.refreshToken,
        }).toString(),
      ),
    },
    options.signal,
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.body))
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    parsed = null
  }
  const retrySeconds = Number.parseInt(response.headers["retry-after"] ?? "", 10)
  const retryAfterMs =
    Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds * 1_000 : null
  if (response.status < 200 || response.status >= 300) {
    const code = errorSchema.safeParse(parsed)
    return {
      ok: false,
      kind:
        code.success &&
        [
          "invalid_grant",
          "invalid_client",
          "unauthorized_client",
          "unsupported_grant_type",
        ].includes(code.data.error ?? "")
          ? "terminal"
          : "transient",
      retryAfterMs,
    }
  }
  const result = responseSchema.safeParse(parsed)
  if (!result.success) return { ok: false, kind: "transient", retryAfterMs }
  const now = options.clock.nowMs()
  return {
    ok: true,
    credentials: {
      accessToken: result.data.access_token,
      refreshToken: result.data.refresh_token ?? options.refreshToken,
      expiresAtMs:
        result.data.expires_at !== undefined && result.data.expires_at > now
          ? Math.trunc(result.data.expires_at)
          : Math.trunc(now + (result.data.expires_in ?? 36_000) * 1_000),
    },
  }
}

export async function refreshClaudeAccessToken(
  options: Parameters<typeof refreshClaudeAccessTokenResult>[0],
): Promise<ClaudeCredentials | null> {
  const result = await refreshClaudeAccessTokenResult(options)
  return result.ok ? result.credentials : null
}
