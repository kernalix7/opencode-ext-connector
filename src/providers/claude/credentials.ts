import { z } from "zod"

export type ClaudeCredentials = {
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly expiresAtMs: number | null
}

const envelopeSchema = z.record(z.string(), z.unknown())
const credentialSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().finite().transform(Math.trunc),
  })
  .passthrough()

export function parseClaudeCredentials(value: unknown): ClaudeCredentials | null {
  const envelope = envelopeSchema.safeParse(value)
  if (!envelope.success) return null
  const payload = Object.hasOwn(envelope.data, "claudeAiOauth")
    ? envelope.data["claudeAiOauth"]
    : envelope.data
  const parsed = credentialSchema.safeParse(payload)
  return parsed.success
    ? Object.freeze({
        accessToken: parsed.data.accessToken,
        refreshToken: parsed.data.refreshToken,
        expiresAtMs: parsed.data.expiresAt,
      })
    : null
}

export function claudeAccessNeedsRefresh(
  credentials: ClaudeCredentials,
  nowMs: number,
  skewMs = 60_000,
): boolean {
  return credentials.expiresAtMs !== null && credentials.expiresAtMs - skewMs <= nowMs
}
