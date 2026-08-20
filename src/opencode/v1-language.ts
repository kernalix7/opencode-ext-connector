import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { Clock } from "../core/clock"
import { createFetchHttpTransport } from "../http/fetch-transport"
import { createClaudeTokenReader } from "../providers/claude/auth"
import { spawnCursorPooledChild } from "../providers/cursor/child"
import { createCursorAgentPool } from "../providers/cursor/pool"
import { createConnectorLanguage } from "./language-factory"

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
const cursorPool = createCursorAgentPool({
  clock,
  spawn: spawnCursorPooledChild,
  env,
})
const cursorSessions = new Map<string, string>()
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
    cursorPool,
    cursorSessions,
    ...(commandCodeApiKey === undefined ? {} : { commandCodeApiKey }),
  })
  const model = createLanguage(providerID, modelId)
  if (model === null) {
    throw new Error(`${providerID} is unavailable`)
  }
  return model
}

export async function disposeV1LanguageRuntime(): Promise<void> {
  await cursorPool.dispose()
}
