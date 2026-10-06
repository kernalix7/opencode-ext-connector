import type { AuthHook } from "@opencode-ai/plugin"

export function createApiKeyAuthHook(provider: "claude" | "command-code"): AuthHook {
  return {
    provider,
    methods: [
      { type: "api", label: provider === "claude" ? "Claude API key" : "Command Code API key" },
    ],
  }
}
