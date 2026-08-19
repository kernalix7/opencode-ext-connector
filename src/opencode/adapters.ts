import type { ProviderAdapter } from "../core/adapter"
import type { HttpTransport } from "../core/http"
import { createClaudeAdapter } from "../providers/claude/adapter"
import { readClaudeAccessToken } from "../providers/claude/auth"
import { listClaudeModels } from "../providers/claude/models"
import { createCommandCodeAdapter } from "../providers/command-code/adapter"
import { readCommandCodeAccessToken } from "../providers/command-code/auth"
import { listCommandCodeModels } from "../providers/command-code/models"
import { createCursorAdapter } from "../providers/cursor/adapter"
import { resolveCursorAgent } from "../providers/cursor/auth"
import { listCursorModels } from "../providers/cursor/models"

export function createDefaultAdapters(
  env: Readonly<Record<string, string | undefined>>,
  transport: HttpTransport,
): readonly ProviderAdapter[] {
  return [
    createClaudeAdapter({
      readAccessToken: (signal) => readClaudeAccessToken(env, signal),
      listModels: (token, signal) => listClaudeModels(transport, token, signal),
    }),
    createCursorAdapter({
      resolveAgent: (signal) => resolveCursorAgent(env, signal),
      listModels: listCursorModels,
    }),
    createCommandCodeAdapter({
      readAccessToken: (signal) => readCommandCodeAccessToken(env, signal),
      listModels: (token, signal) => listCommandCodeModels(transport, token, signal),
    }),
  ]
}
