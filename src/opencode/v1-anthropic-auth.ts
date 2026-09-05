import type { AuthHook } from "@opencode-ai/plugin"

import { createClaudeCompatibilityFetch } from "../providers/claude/compat-request.js"
import type { ClaudeCredentials } from "../providers/claude/credentials.js"

export function createAnthropicCliAuth(options: {
  readonly readCredentials: (signal: AbortSignal) => Promise<ClaudeCredentials | null>
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly readVersion: (signal: AbortSignal) => Promise<string | null>
  readonly provider?: string
}): AuthHook {
  const provider = options.provider ?? "anthropic"
  return {
    provider,
    loader: async (getAuth) => {
      const auth = await getAuth()
      if (!("type" in auth) || auth.type !== "oauth") {
        return {}
      }
      const credentials = await options.readCredentials(new AbortController().signal)
      if (credentials === null) {
        return {}
      }
      return {
        apiKey: "",
        baseURL: "https://api.anthropic.com/v1",
        fetch: createClaudeCompatibilityFetch({
          readVersion: options.readVersion,
          readAccessToken: options.readAccessToken,
          forceRefreshAccessToken: options.forceRefreshAccessToken,
        }),
      }
    },
    methods: [
      {
        type: "oauth",
        label: "Claude Code subscription",
        authorize: async () => {
          const credentials = await options.readCredentials(new AbortController().signal)
          if (credentials === null) {
            return {
              url: "",
              instructions:
                "No Claude Code credentials were found. Log in with Claude Code once or copy an existing `~/.claude/.credentials.json` here, then retry.",
              method: "auto",
              callback: async () => ({ type: "failed" }),
            }
          }
          return {
            url: "",
            instructions: "Using existing Claude Code credentials.",
            method: "auto",
            callback: async () => ({
              type: "success",
              provider,
              access: credentials.accessToken,
              refresh: credentials.refreshToken ?? "",
              expires: credentials.expiresAtMs ?? 0,
            }),
          }
        },
      },
    ],
  }
}
