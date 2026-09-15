import { mock } from "bun:test"

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"

import type { AsyncDisposableHandle } from "../../../src/core/lifecycle"
import type { ProcessSupervisor } from "../../../src/core/process"
import type { ClaudeCredentialAuthoritySchedulerOptions } from "../../../src/providers/claude/credential-authority-scheduler"

class UnexpectedProcessStartError extends Error {
  public override readonly name = "UnexpectedProcessStartError"
}

const authorityFailure = new Error("authority disposal failed")
let authorityOptions: ClaudeCredentialAuthoritySchedulerOptions | undefined
let creationEvents: string[] = []
let disposalEvents: string[] = []
let failDisposal = false

const supervisor: ProcessSupervisor = {
  start: async () => {
    throw new UnexpectedProcessStartError()
  },
  dispose: async () => {
    disposalEvents.push("supervisor")
  },
  [Symbol.asyncDispose]: async () => {
    disposalEvents.push("supervisor")
  },
}

mock.module("../../../src/process/production-supervisor", () => ({
  createProductionProcessSupervisor: (): ProcessSupervisor => {
    creationEvents.push("supervisor")
    return supervisor
  },
}))

mock.module("../../../src/providers/claude/credential-authority-scheduler", () => ({
  createClaudeCredentialAuthorityScheduler: (
    options: ClaudeCredentialAuthoritySchedulerOptions,
  ): AsyncDisposableHandle => {
    creationEvents.push("authority")
    authorityOptions = options
    const dispose = async (): Promise<void> => {
      disposalEvents.push("authority")
      if (failDisposal) throw authorityFailure
    }
    return { dispose, [Symbol.asyncDispose]: dispose }
  },
}))

mock.module("../../../src/opencode/v1-module", () => ({
  buildV1AuthHooks: (): Hooks => ({}),
  createV1AuthServer: () => async (): Promise<Hooks> => ({}),
  createV1Server: () => async (): Promise<Hooks> => {
    creationEvents.push("hooks")
    return {
      dispose: async () => {
        disposalEvents.push("hooks")
        if (failDisposal) throw new Error("hooks disposal failed")
      },
    }
  },
}))

mock.module("../../../src/opencode/v1-language", () => ({
  disposeV1LanguageRuntime: async (): Promise<void> => {
    disposalEvents.push("runtime")
    if (failDisposal) throw new Error("runtime disposal failed")
  },
}))

const { connectorServer } = await import("../../../src/server")

const enabledOptions = {
  providers: ["claude"],
  credentialManagement: "external",
  credentialAuthority: {
    claudeCli: { enabled: true, leadMs: 12_345, retryMs: 67_890 },
  },
}
const pluginInput: PluginInput = {
  client: createOpencodeClient(),
  project: {
    id: "server-lifecycle",
    worktree: "/workspace/project",
    time: { created: 0 },
  },
  directory: "/workspace/project",
  worktree: "/workspace/project",
  experimental_workspace: { register: () => undefined },
  serverUrl: new URL("http://127.0.0.1"),
  $: Bun.$,
}

const successfulHooks = await connectorServer(pluginInput, enabledOptions)
const options = authorityOptions
if (options === undefined) throw new Error("authority was not created")
await successfulHooks.dispose?.()
const successfulDisposalEvents = disposalEvents

creationEvents = []
disposalEvents = []
failDisposal = true
const failedHooks = await connectorServer(pluginInput, enabledOptions)
let primaryFailure = "none"
try {
  await failedHooks.dispose?.()
} catch (error) {
  primaryFailure = error === authorityFailure ? "authority" : "unexpected"
}

process.stdout.write(
  JSON.stringify({
    creationEvents,
    options: {
      enabled: options.enabled,
      leadMs: options.leadMs,
      retryMs: options.retryMs,
      envIsProcessEnv: options.env === process.env,
      supervisorMatches: options.processSupervisor === supervisor,
      hasClock: typeof options.clock.nowMs === "function",
      hasLogger: typeof options.logger.log === "function",
    },
    successfulDisposalEvents,
    failedDisposalEvents: disposalEvents,
    primaryFailure,
  }),
)
