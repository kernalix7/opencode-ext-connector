import { spawnSync } from "node:child_process"

import type { AuthHook } from "@opencode-ai/plugin"

import { readCommandCodeAccessToken } from "../providers/command-code/auth"
import { resolveCursorAgent } from "../providers/cursor/auth"

const CURSOR_SESSION_MARKER = "cli-session:cursor"
const COMMAND_CODE_SESSION_MARKER = "cli-session:command-code"

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
  const signal = new AbortController().signal
  const executable = await resolveCursorAgent(env, signal)
  if (executable === null) {
    return false
  }
  const result = spawnSync(executable, ["status"], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...env },
  })
  return result.error === undefined && result.status === 0
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
    loader: async () => ({}),
    methods: [
      sessionMethod({
        provider: "cursor",
        label: "Cursor Agent login",
        instructions: "Using the existing cursor-agent login session.",
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
    loader: async (getAuth) => {
      const auth = await getAuth()
      if ("type" in auth && auth.type === "api" && auth.key !== COMMAND_CODE_SESSION_MARKER) {
        return { apiKey: auth.key }
      }
      return {}
    },
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
