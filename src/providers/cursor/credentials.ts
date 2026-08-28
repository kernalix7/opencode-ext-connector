// Derived from Rahularya01/pi-cursor src/auth/cli-credentials.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

export type CursorCredentials = {
  readonly accessToken: string
  readonly refreshToken: string | null
}

function stringField(value: object, key: string): string | null {
  if (!(key in value)) {
    return null
  }
  const field = Reflect.get(value, key)
  return typeof field === "string" && field.length > 0 ? field : null
}

export function parseCursorCredentials(value: unknown): CursorCredentials | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const accessToken = stringField(value, "accessToken")
  if (accessToken === null) {
    return null
  }
  return {
    accessToken,
    refreshToken: stringField(value, "refreshToken"),
  }
}
