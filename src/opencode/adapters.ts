import type { ProviderAdapter } from "../core/adapter"
import { createClaudeAdapter } from "../providers/claude/adapter"
import { readClaudeAccessToken } from "../providers/claude/auth"
import { createCommandCodeAdapter } from "../providers/command-code/adapter"
import { readCommandCodeAccessToken } from "../providers/command-code/auth"
import { createCursorAdapter } from "../providers/cursor/adapter"
import { resolveCursorAgent } from "../providers/cursor/auth"
import { CLAUDE_CATALOG, COMMAND_CODE_CATALOG, CURSOR_CATALOG } from "./catalogs"

export function createDefaultAdapters(
  env: Readonly<Record<string, string | undefined>>,
): readonly ProviderAdapter[] {
  return [
    createClaudeAdapter({
      readAccessToken: (signal) => readClaudeAccessToken(env, signal),
      models: CLAUDE_CATALOG,
    }),
    createCursorAdapter({
      resolveAgent: (signal) => resolveCursorAgent(env, signal),
      models: CURSOR_CATALOG,
    }),
    createCommandCodeAdapter({
      readAccessToken: (signal) => readCommandCodeAccessToken(env, signal),
      models: COMMAND_CODE_CATALOG,
    }),
  ]
}
