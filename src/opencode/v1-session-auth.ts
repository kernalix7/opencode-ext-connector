import type { AuthHook } from "@opencode-ai/plugin"
import { readCommandCodeAccessToken } from "../providers/command-code/auth.js"

import { type OllamaEndpoints, parseOllamaEndpoints } from "../providers/ollama/endpoints.js"
import { type OllamaFetch, productionOllamaFetch } from "../providers/ollama/http.js"
import { probeLocalOllama } from "./ollama-probe.js"

const OLLAMA_SESSION_MARKER = "cli-session:ollama"
const OLLAMA_AVAILABLE_INSTRUCTIONS =
  "The connector will reuse the running configured Ollama daemon. Cloud access remains managed by `ollama signin`; this plugin does not run sign-in."
const OLLAMA_UNAVAILABLE_INSTRUCTIONS = "Start the configured Ollama daemon, then retry."

export function createCommandCodeSessionAuth(
  env: Readonly<Record<string, string | undefined>>,
): AuthHook {
  return {
    provider: "command-code",
    methods: [
      {
        type: "oauth",
        label: "Existing Command Code session",
        authorize: async () => ({
          url: "",
          instructions: "Use the existing Command Code login.",
          method: "auto",
          callback: async () =>
            (await readCommandCodeAccessToken(env, new AbortController().signal)) === null
              ? { type: "failed" }
              : { type: "success", provider: "command-code", key: "cli-session:command-code" },
        }),
      },
      { type: "api", label: "Command Code direct key" },
    ],
  }
}

export function createOllamaSessionAuth(
  fetch: OllamaFetch = productionOllamaFetch,
  endpoints: OllamaEndpoints = parseOllamaEndpoints(undefined),
): AuthHook {
  return {
    provider: "ollama",
    methods: [
      {
        type: "oauth",
        label: "Ollama daemon",
        authorize: async () => {
          const available = await probeLocalOllama(fetch, endpoints)
          return {
            url: "",
            instructions: available
              ? OLLAMA_AVAILABLE_INSTRUCTIONS
              : OLLAMA_UNAVAILABLE_INSTRUCTIONS,
            method: "auto",
            callback: async () =>
              (await probeLocalOllama(fetch, endpoints))
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
