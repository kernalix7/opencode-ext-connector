import type { AuthHook } from "@opencode-ai/plugin"

import { readCommandCodeAccessToken } from "../providers/command-code/auth.js"
import { readCursorAccessToken } from "../providers/cursor/auth.js"
import { type OllamaFetch, productionOllamaFetch } from "../providers/ollama/http.js"
import { probeLocalOllama } from "./ollama-probe.js"

const CURSOR_SESSION_MARKER = "cli-session:cursor"
const COMMAND_CODE_SESSION_MARKER = "cli-session:command-code"
const OLLAMA_SESSION_MARKER = "cli-session:ollama"
const OLLAMA_AVAILABLE_INSTRUCTIONS =
  "The connector will reuse the running local Ollama daemon. Cloud access remains managed by `ollama signin`; this plugin does not run sign-in."
const OLLAMA_UNAVAILABLE_INSTRUCTIONS = "Start the local Ollama daemon, then retry."

function sessionMethod(options: {
  readonly provider: string
  readonly label: string
  readonly instructions: string
  readonly marker: string
  readonly verify: () => Promise<boolean>
}): AuthHook["methods"][number] {
  return {
    type: "oauth",
    label: options.label,
    authorize: async () => {
      const available = await options.verify()
      return {
        url: "",
        instructions: available
          ? options.instructions
          : `No logged-in ${options.label} session was found. Log in with the vendor CLI, then retry.`,
        method: "auto",
        callback: async () =>
          available
            ? {
                type: "success",
                provider: options.provider,
                key: options.marker,
              }
            : { type: "failed" },
      }
    },
  }
}

async function hasCursorSession(
  env: Readonly<Record<string, string | undefined>>,
): Promise<boolean> {
  return (await readCursorAccessToken(env, new AbortController().signal)) !== null
}

async function hasCommandCodeSession(
  env: Readonly<Record<string, string | undefined>>,
): Promise<boolean> {
  return (await readCommandCodeAccessToken(env, new AbortController().signal)) !== null
}

export function createCursorSessionAuth(
  env: Readonly<Record<string, string | undefined>>,
): AuthHook {
  return {
    provider: "cursor",
    methods: [
      sessionMethod({
        provider: "cursor",
        label: "Cursor CLI login",
        instructions: "Using the existing Cursor CLI login/token.",
        marker: CURSOR_SESSION_MARKER,
        verify: () => hasCursorSession(env),
      }),
    ],
  }
}

export function createCommandCodeSessionAuth(
  env: Readonly<Record<string, string | undefined>>,
): AuthHook {
  return {
    provider: "command-code",
    methods: [
      sessionMethod({
        provider: "command-code",
        label: "Command Code CLI login",
        instructions: "Using the existing Command Code CLI session.",
        marker: COMMAND_CODE_SESSION_MARKER,
        verify: () => hasCommandCodeSession(env),
      }),
      {
        type: "api",
        label: "Command Code API key",
      },
    ],
  }
}

export function createOllamaSessionAuth(fetch: OllamaFetch = productionOllamaFetch): AuthHook {
  return {
    provider: "ollama",
    methods: [
      {
        type: "oauth",
        label: "Ollama local daemon",
        authorize: async () => {
          const available = await probeLocalOllama(fetch)
          return {
            url: "",
            instructions: available
              ? OLLAMA_AVAILABLE_INSTRUCTIONS
              : OLLAMA_UNAVAILABLE_INSTRUCTIONS,
            method: "auto",
            callback: async () =>
              (await probeLocalOllama(fetch))
                ? {
                    type: "success",
                    provider: "ollama",
                    key: OLLAMA_SESSION_MARKER,
                  }
                : { type: "failed" },
          }
        },
      },
    ],
  }
}
