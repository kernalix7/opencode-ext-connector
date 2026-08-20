// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

export type ClaudeModelOverride = {
  readonly exclude?: readonly string[]
  readonly add?: readonly string[]
  readonly disableEffort?: boolean
}

export const CLAUDE_BASE_BETAS: readonly string[] = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "prompt-caching-scope-2026-01-05",
  "context-management-2025-06-27",
  "advisor-tool-2026-03-01",
  "thinking-token-count-2026-05-13",
  "extended-cache-ttl-2025-04-11",
]

export const CLAUDE_LONG_CONTEXT_BETAS: readonly string[] = [
  "context-1m-2025-08-07",
  "interleaved-thinking-2025-05-14",
]

const MODEL_OVERRIDES: Readonly<Record<string, ClaudeModelOverride>> = {
  sonnet: { exclude: ["effort-2025-11-24"] },
  haiku: { exclude: ["effort-2025-11-24"], disableEffort: true },
  "4-6": { add: ["effort-2025-11-24"] },
  "4-7": { add: ["effort-2025-11-24"] },
}

export function claudeModelOverride(modelId: string): ClaudeModelOverride | null {
  const lower = modelId.toLowerCase()
  for (const [pattern, override] of Object.entries(MODEL_OVERRIDES)) {
    if (lower.includes(pattern)) {
      return override
    }
  }
  return null
}
