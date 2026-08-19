export type ClaudeCredentials = {
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly expiresAtMs: number | null
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
  return typeof field === "number" && Number.isFinite(field) ? Math.trunc(field) : null
}

export function parseClaudeCredentials(value: unknown): ClaudeCredentials | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const oauth = "claudeAiOauth" in value ? Reflect.get(value, "claudeAiOauth") : value
  if (typeof oauth !== "object" || oauth === null) {
    return null
  }
  const accessToken = stringField(oauth, "accessToken")
  if (accessToken === null) {
    return null
  }
  return {
    accessToken,
    refreshToken: stringField(oauth, "refreshToken"),
    expiresAtMs: numberField(oauth, "expiresAt"),
  }
}

export function claudeAccessNeedsRefresh(
  credentials: ClaudeCredentials,
  nowMs: number,
  skewMs = 60_000,
): boolean {
  return credentials.expiresAtMs !== null && credentials.expiresAtMs - skewMs <= nowMs
}
