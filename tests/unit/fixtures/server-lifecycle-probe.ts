import { mock } from "bun:test"

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"

const creationEvents: string[] = []
const disposalEvents: string[] = []
const failure = new Error("fixture-hook-disposal")
let failDisposal = false

mock.module("../../../src/opencode/v1-module", () => ({
  buildV1AuthHooks: (): Hooks => ({}),
  createV1AuthServer: () => async (): Promise<Hooks> => ({}),
  createV1Server: () => async (): Promise<Hooks> => {
    creationEvents.push("hooks")
    return {
      dispose: async () => {
        disposalEvents.push("hooks")
        if (failDisposal) throw failure
      },
    }
  },
}))

const { connectorServer, cursorAuthServer, xaiAuthServer } = await import("../../../src/server")
const input: PluginInput = {
  client: createOpencodeClient(),
  project: { id: "server-lifecycle", worktree: "/fixture", time: { created: 0 } },
  directory: "/fixture",
  worktree: "/fixture",
  experimental_workspace: { register: () => undefined },
  serverUrl: new URL("http://127.0.0.1"),
  $: Bun.$,
}
const cursor = await cursorAuthServer(input)
const xai = await xaiAuthServer(input)
const success = await connectorServer(input, { providers: [] })
const first = success.dispose?.()
const second = success.dispose?.()
await first
failDisposal = true
const failed = await connectorServer(input, { providers: [] })
let propagated = false
try {
  await failed.dispose?.()
} catch (error: unknown) {
  if (error !== failure) throw error
  propagated = true
}
process.stdout.write(
  JSON.stringify({
    creationEvents,
    disposalEvents,
    samePromise: first === second,
    cursorHasAuth: cursor.auth !== undefined,
    xaiHasAuth: xai.auth !== undefined,
    propagated,
  }),
)
