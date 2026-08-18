import type { ProviderAdapter } from "../core/adapter"
import { parseModelId } from "../core/ids"
import { createClaudeAdapter } from "../providers/claude/adapter"
import { readClaudeAccessToken } from "../providers/claude/auth"
import { createCommandCodeAdapter } from "../providers/command-code/adapter"
import { readCommandCodeAccessToken } from "../providers/command-code/auth"
import { createCursorAdapter } from "../providers/cursor/adapter"
import { resolveCursorAgent } from "../providers/cursor/auth"

export function createDefaultAdapters(
  env: Readonly<Record<string, string | undefined>>,
): readonly ProviderAdapter[] {
  return [
    createClaudeAdapter({
      readAccessToken: (signal) => readClaudeAccessToken(env, signal),
      models: [
        { id: parseModelId("claude-opus-4-6") },
        { id: parseModelId("claude-sonnet-4-6") },
        { id: parseModelId("claude-haiku-4-5") },
      ],
    }),
    createCursorAdapter({
      resolveAgent: (signal) => resolveCursorAgent(env, signal),
      models: [{ id: parseModelId("auto") }],
    }),
    createCommandCodeAdapter({
      readAccessToken: (signal) => readCommandCodeAccessToken(env, signal),
      models: [{ id: parseModelId("default") }],
    }),
  ]
}
