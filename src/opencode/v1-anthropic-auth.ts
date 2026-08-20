import type { AuthHook } from "@opencode-ai/plugin"

import { createClaudeCompatibilityFetch } from "../providers/claude/compat-request"
import type { ClaudeCredentials } from "../providers/claude/credentials"

export function createAnthropicCliAuth(options: {
  readonly readCredentials: (signal: AbortSignal) => Promise<ClaudeCredentials | null>
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly cliVersion: string | null
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
      const version = options.cliVersion
      if (version === null) {
        return {}
      }
      return {
        apiKey: "",
        baseURL: "https://api.anthropic.com/v1",
        fetch: createClaudeCompatibilityFetch({
          version,
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
          if (options.cliVersion === null) {
            return {
              url: "",
              instructions: "Claude CLI was not found. Install `claude`, log in, then retry.",
              method: "auto",
              callback: async () => ({ type: "failed" }),
            }
          }
          const credentials = await options.readCredentials(new AbortController().signal)
          if (credentials === null) {
            return {
              url: "",
              instructions: "Run `claude` to log in, then retry this method.",
              method: "auto",
              callback: async () => ({ type: "failed" }),
            }
          }
          return {
            url: "",
            instructions: "Using existing Claude Code CLI credentials.",
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
