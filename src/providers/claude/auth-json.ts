import type { ClaudeCredentials } from "./credentials.js"

export function mergeOpencodeAuthJson(existing: unknown, credentials: ClaudeCredentials): string {
  const root =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...existing }
      : {}
  return `${JSON.stringify(
    {
      ...root,
      anthropic: {
        type: "oauth",
        access: credentials.accessToken,
        refresh: credentials.refreshToken,
        expires: credentials.expiresAtMs,
      },
    },
    null,
    2,
  )}\n`
}
