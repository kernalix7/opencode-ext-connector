import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { Hooks, Plugin as V1Plugin } from "@opencode-ai/plugin"

import { createFetchHttpTransport } from "./http/fetch-transport"
import { createDefaultAdapters } from "./opencode/adapters"
import { createAnthropicCliAuth } from "./opencode/v1-anthropic-auth"
import { disposeV1LanguageRuntime } from "./opencode/v1-language"
import { createV1Server } from "./opencode/v1-module"
import { createCommandCodeSessionAuth, createCursorSessionAuth } from "./opencode/v1-session-auth"
import { createClaudeTokenManager, readClaudeCredentials } from "./providers/claude/auth"
import { readClaudeCliVersion } from "./providers/claude/cli-version"

const env = process.env
const transport = createFetchHttpTransport()
const clock = {
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
const distDirectory = dirname(fileURLToPath(import.meta.url))
const claudeTokens = createClaudeTokenManager({ env, clock, transport })

const connector = createV1Server({
  clock,
  adapters: createDefaultAdapters(env, transport),
  npmSpecifiers: {
    cursor: pathToFileURL(join(distDirectory, "sdk", "cursor.js")).href,
    "command-code": pathToFileURL(join(distDirectory, "sdk", "command-code.js")).href,
  },
  fallbackModelIds: {
    cursor: ["auto"],
    "command-code": ["Qwen/Qwen3.8-Max"],
  },
  anthropicAuth: createAnthropicCliAuth({
    provider: "anthropic",
    readCredentials: (signal) => readClaudeCredentials(env, signal),
    readAccessToken: claudeTokens.readAccessToken,
    forceRefreshAccessToken: claudeTokens.forceRefreshAccessToken,
    cliVersion: readClaudeCliVersion(env),
  }),
})

export const connectorServer: V1Plugin = async (input, options): Promise<Hooks> => {
  const hooks = await connector(input, options)
  const dispose = hooks.dispose
  return {
    ...hooks,
    dispose: async (): Promise<void> => {
      await dispose?.()
      await disposeV1LanguageRuntime()
    },
  }
}

export const cursorAuthServer: V1Plugin = async (): Promise<Hooks> => ({
  auth: createCursorSessionAuth(env),
})

export const commandCodeAuthServer: V1Plugin = async (): Promise<Hooks> => ({
  auth: createCommandCodeSessionAuth(env),
})
