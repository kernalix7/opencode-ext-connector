import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { Clock } from "./core/clock"
import { parseConnectorOptions } from "./core/options"
import { createFetchHttpTransport } from "./http/fetch-transport"
import { createConsoleLogger } from "./logging/logger"
import { createDefaultAdapters } from "./opencode/adapters"
import { define, type Plugin } from "./opencode/beta-api"
import { createCatalogPublisher } from "./opencode/catalog-bridge"
import { PLUGIN_ID, setupConnector } from "./opencode/plugin"
import { readClaudeAccessToken } from "./providers/claude/auth"
import { createClaudeLanguageModel } from "./providers/claude/language-model"
import { readCommandCodeAccessToken } from "./providers/command-code/auth"
import { createCommandCodeLanguageModel } from "./providers/command-code/language-model"
import { createCursorLanguageModel } from "./providers/cursor/language-model"
import { runCursorAgentPrompt } from "./providers/cursor/runner"

export const systemClock: Clock = {
  nowMs: (): number => Date.now(),
  schedule: (delayMs: number, callback: () => void) => {
    const handle = setTimeout(callback, delayMs)
    const cancel = (): void => {
      clearTimeout(handle)
    }
    return {
      cancel,
      [Symbol.dispose]: cancel,
    }
  },
}

export const plugin: Plugin = define({
  id: PLUGIN_ID,
  setup: async (context): Promise<void> => {
    const env = process.env
    const transport = createFetchHttpTransport()
    const connectorOptions = parseConnectorOptions({})
    await setupConnector({
      catalog: context.catalog,
      adapters: createDefaultAdapters(env),
      logger: createConsoleLogger(systemClock),
      createPublisher: createCatalogPublisher,
      clock: systemClock,
      health: connectorOptions.health,
      aisdk: context.aisdk,
      createLanguage: (providerID: string, modelId: string): LanguageModelV3 | null => {
        if (providerID === "claude") {
          return createClaudeLanguageModel({
            modelId,
            transport,
            readAccessToken: (signal) => readClaudeAccessToken(env, signal),
          })
        }
        if (providerID === "cursor") {
          return createCursorLanguageModel({
            modelId,
            runPrompt: (prompt, signal) => runCursorAgentPrompt(env, prompt, signal),
          })
        }
        if (providerID === "command-code") {
          return createCommandCodeLanguageModel({
            modelId,
            transport,
            readAccessToken: (signal) => readCommandCodeAccessToken(env, signal),
          })
        }
        return null
      },
    })
  },
})

export default plugin
