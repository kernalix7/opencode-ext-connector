import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { Clock } from "../core/clock.js"
import { createFetchHttpTransport } from "../http/fetch-transport.js"
import { createConsoleLogger } from "../logging/logger.js"
import { createClaudeTokenReader } from "../providers/claude/auth.js"
import { readCursorAccessToken } from "../providers/cursor/auth.js"
import { createCursorDirectRuntime } from "../providers/cursor/direct-runtime.js"
import { createConnectorLanguage } from "./language-factory.js"
import { productionOllamaRuntime } from "./ollama-production.js"

const clock: Clock = {
  nowMs: (): number => Date.now(),
  schedule: (delayMs: number, callback: () => void) => {
    const handle = setTimeout(callback, delayMs)
    handle.unref()
    const cancel = (): void => {
      clearTimeout(handle)
    }
    return {
      cancel,
      [Symbol.dispose]: cancel,
    }
  },
}

const env = process.env
const transport = createFetchHttpTransport()
const logger = createConsoleLogger(clock)
const cursorRuntime = createCursorDirectRuntime({
  clock,
  readAccessToken: (signal) => readCursorAccessToken(env, signal),
  onBackgroundCleanupError: (error) => {
    logger.log("warn", "cursor.session.ttl-cleanup-failed", {
      code: error.code,
      operation: error.operation,
      sessionId: error.identity.sessionId,
      modelId: error.identity.modelId,
    })
  },
})
const readClaudeToken = createClaudeTokenReader({
  env,
  clock,
  transport,
})

function apiKeyFromOptions(options: Readonly<Record<string, unknown>>): string | undefined {
  const value = options["apiKey"]
  return typeof value === "string" && value.length > 0 && !value.startsWith("cli-session:")
    ? value
    : undefined
}

export function languageForV1Provider(
  providerID: string,
  modelId: string,
  options: Readonly<Record<string, unknown>>,
): LanguageModelV3 {
  const commandCodeApiKey = apiKeyFromOptions(options)
  const createLanguage = createConnectorLanguage({
    env,
    transport,
    readClaudeToken,
    cursorRuntime,
    ollamaRuntime: productionOllamaRuntime,
    ...(commandCodeApiKey === undefined ? {} : { commandCodeApiKey }),
  })
  const model = createLanguage(providerID, modelId)
  if (model === null) {
    throw new Error(`${providerID} is unavailable`)
  }
  return model
}

export const disposeV1LanguageRuntime: () => Promise<void> = cursorRuntime.dispose
