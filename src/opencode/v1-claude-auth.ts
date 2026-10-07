import type { AuthHook } from "@opencode-ai/plugin"
import { readClaudeCredentials } from "../providers/claude/auth.js"
import type { ProviderEntryDeps } from "./provider-entry.js"
import { createScopedClaudeLoader } from "./v1-claude-loader.js"

export function createClaudeSessionAuth(
  deps: ProviderEntryDeps,
): AuthHook & { readonly dispose: () => Promise<void> } {
  const scoped = createScopedClaudeLoader(deps)
  return {
    provider: "anthropic",
    loader: scoped.loader,
    dispose: scoped.dispose,
    methods: [
      {
        type: "oauth",
        label: "Existing Claude Code session",
        authorize: async () => ({
          url: "",
          instructions: "Use the existing Claude Code login.",
          method: "auto",
          callback: async () =>
            (await readClaudeCredentials(
              deps.env,
              new AbortController().signal,
              deps.claudeAuthLookup,
            )) === null
              ? { type: "failed" }
              : { type: "success", provider: "anthropic", key: "cli-session:anthropic" },
        }),
      },
    ],
  }
}
