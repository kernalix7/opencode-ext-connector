import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { HttpTransport } from "../core/http"
import { createClaudeLanguageModel } from "../providers/claude/language-model"
import { readCommandCodeAccessToken } from "../providers/command-code/auth"
import { createCommandCodeLanguageModel } from "../providers/command-code/language-model"
import type { CursorDirectRuntime } from "../providers/cursor/direct-runtime"
import { createCursorLanguageModel } from "../providers/cursor/language-model"
import { createOllamaLanguageModel } from "../providers/ollama/language-model"
import type { OllamaRuntime } from "../providers/ollama/runtime"

export type ConnectorLanguageDeps = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly transport: HttpTransport
  readonly readClaudeToken: (signal: AbortSignal) => Promise<string | null>
  readonly cursorRuntime: CursorDirectRuntime
  readonly ollamaRuntime: OllamaRuntime
  readonly commandCodeApiKey?: string
}

export function createConnectorLanguage(
  deps: ConnectorLanguageDeps,
): (providerID: string, modelId: string) => LanguageModelV3 | null {
  return (providerID: string, modelId: string): LanguageModelV3 | null => {
    if (providerID === "claude") {
      return createClaudeLanguageModel({
        modelId,
        transport: deps.transport,
        readAccessToken: deps.readClaudeToken,
      })
    }
    if (providerID === "cursor") {
      return createCursorLanguageModel({
        modelId,
        runPrompt: async () => null,
        directRuntime: deps.cursorRuntime,
      })
    }
    if (providerID === "command-code") {
      return createCommandCodeLanguageModel({
        modelId,
        transport: deps.transport,
        readAccessToken: (signal) =>
          deps.commandCodeApiKey === undefined
            ? readCommandCodeAccessToken(deps.env, signal)
            : Promise.resolve(deps.commandCodeApiKey),
      })
    }
    if (providerID === "ollama") {
      return createOllamaLanguageModel({ modelId, runtime: deps.ollamaRuntime })
    }
    return null
  }
}
