import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { Clock } from "./core/clock"
import { parseConnectorOptions } from "./core/options"
import { createFetchHttpTransport } from "./http/fetch-transport"
import { createConsoleLogger } from "./logging/logger"
import { createDefaultAdapters } from "./opencode/adapters"
import { define, type Plugin } from "./opencode/beta-api"
import { createCatalogPublisher } from "./opencode/catalog-bridge"
import { pickConnectorOptionsInput } from "./opencode/host-options"
import { PLUGIN_ID, setupConnector } from "./opencode/plugin"
import { readClaudeAccessToken } from "./providers/claude/auth"
import { createClaudeLanguageModel } from "./providers/claude/language-model"
import { readCommandCodeAccessToken } from "./providers/command-code/auth"
import { createCommandCodeLanguageModel } from "./providers/command-code/language-model"
import { resolveCursorAgent } from "./providers/cursor/auth"
import { spawnCursorPooledChild } from "./providers/cursor/child"
import { createCursorLanguageModel } from "./providers/cursor/language-model"
import { createCursorAgentPool } from "./providers/cursor/pool"
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
    const connectorOptions = parseConnectorOptions(pickConnectorOptionsInput(context.options))
    const cursorPool = createCursorAgentPool({
      clock: systemClock,
      spawn: spawnCursorPooledChild,
      env,
    })
    await setupConnector({
      catalog: {
        transform: async (callback) => {
          const registration = await context.catalog.transform(callback)
          return {
            dispose: async (): Promise<void> => {
              await cursorPool.dispose()
              await registration.dispose()
            },
          }
        },
      },
      adapters: createDefaultAdapters(env),
      logger: createConsoleLogger(systemClock),
      createPublisher: createCatalogPublisher,
      clock: systemClock,
      health: connectorOptions.health,
      snapshotTimeoutMs: connectorOptions.snapshotTimeoutMs,
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
          const workspace = process.cwd()
          return createCursorLanguageModel({
            modelId,
            runPrompt: (prompt, signal) =>
              runCursorAgentPrompt(env, prompt, signal, workspace, modelId),
            streamNdjson: async function* (prompt, signal) {
              const agent = await resolveCursorAgent(env, signal)
              if (agent === null) {
                return
              }
              const session = await cursorPool.acquire({
                workspace,
                model: modelId,
                executable: agent,
              })
              if (signal.aborted) {
                session.child.cancel("aborted")
                return
              }
              const onAbort = (): void => {
                session.child.cancel("aborted")
              }
              signal.addEventListener("abort", onAbort, { once: true })
              session.child.writePrompt(prompt)
              try {
                for await (const line of session.child.lines) {
                  yield line
                }
              } finally {
                signal.removeEventListener("abort", onAbort)
              }
            },
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
