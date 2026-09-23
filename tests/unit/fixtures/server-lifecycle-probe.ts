import { mock } from "bun:test"

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"

import type { AsyncDisposableHandle } from "../../../src/core/lifecycle"
import type { ProcessSupervisor } from "../../../src/core/process"
import type { ClaudeCredentialAuthoritySchedulerOptions } from "../../../src/providers/claude/credential-authority-scheduler"
import type { XaiAuthorityObserverOptions } from "../../../src/providers/xai/authority-observer"

class UnexpectedProcessStartError extends Error {
  public override readonly name = "UnexpectedProcessStartError"
}

const claudeAuthorityFailure = new Error("Claude authority disposal failed")
const xaiAuthorityFailure = new Error("xAI authority disposal failed")
let claudeAuthorityOptions: ClaudeCredentialAuthoritySchedulerOptions | undefined
let xaiAuthorityOptions: XaiAuthorityObserverOptions | undefined
let creationEvents: string[] = []
let disposalEvents: string[] = []
let failDisposal = false

const disposeSupervisor = async (): Promise<void> => {
  disposalEvents.push("supervisor")
  if (failDisposal) throw new Error("supervisor disposal failed")
}

const supervisor: ProcessSupervisor = {
  start: async () => {
    throw new UnexpectedProcessStartError()
  },
  dispose: disposeSupervisor,
  [Symbol.asyncDispose]: disposeSupervisor,
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
    creationEvents.push("claude-authority")
    claudeAuthorityOptions = options
    const dispose = async (): Promise<void> => {
      disposalEvents.push("claude-authority")
      if (failDisposal) throw claudeAuthorityFailure
    }
    return { dispose, [Symbol.asyncDispose]: dispose }
  },
}))

mock.module("../../../src/providers/xai/authority-observer", () => ({
  createXaiAuthorityObserver: (options: XaiAuthorityObserverOptions): AsyncDisposableHandle => {
    creationEvents.push("xai-authority")
    xaiAuthorityOptions = options
    const dispose = async (): Promise<void> => {
      disposalEvents.push("xai-authority")
      if (failDisposal) throw xaiAuthorityFailure
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

const {
  connectorServer,
  claudeAuthServer,
  cursorAuthServer,
  commandCodeAuthServer,
  ollamaAuthServer,
  xaiAuthServer,
} = await import("../../../src/server")

const enabledOptions = {
  providers: ["claude"],
  credentialManagement: "external",
  credentialAuthority: {
    claudeCli: { enabled: true, leadMs: 12_345, retryMs: 67_890 },
  },
  xaiOAuth: { mode: "authority" },
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

for (const authServer of [
  claudeAuthServer,
  cursorAuthServer,
  commandCodeAuthServer,
  ollamaAuthServer,
  xaiAuthServer,
]) {
  await authServer(pluginInput, enabledOptions)
}
const standaloneCreationEvents = creationEvents
creationEvents = []

const successfulHooks = await connectorServer(pluginInput, enabledOptions)
const claudeOptions = claudeAuthorityOptions
if (claudeOptions === undefined) throw new Error("Claude authority was not created")
const xaiOptions = xaiAuthorityOptions
if (xaiOptions === undefined) throw new Error("xAI authority was not created")
await successfulHooks.dispose?.()
const successfulDisposalEvents = disposalEvents

creationEvents = []
disposalEvents = []
const standaloneAuthorityHooks = await xaiAuthServer(pluginInput, {
  xaiOAuth: { mode: "authority" },
})
const standaloneConsumerHooks = await xaiAuthServer(pluginInput, {
  xaiOAuth: { mode: "consumer" },
})
const standaloneEvents = creationEvents

creationEvents = []
failDisposal = true
const failedHooks = await connectorServer(pluginInput, enabledOptions)
let primaryFailure = "none"
try {
  await failedHooks.dispose?.()
} catch (error) {
  if (!(error instanceof Error)) throw error
  primaryFailure = error === claudeAuthorityFailure ? "claude-authority" : "unexpected"
}

process.stdout.write(
  JSON.stringify({
    standaloneCreationEvents,
    creationEvents,
    claudeOptions: {
      enabled: claudeOptions.enabled,
      leadMs: claudeOptions.leadMs,
      retryMs: claudeOptions.retryMs,
      envIsProcessEnv: claudeOptions.env === process.env,
      supervisorMatches: claudeOptions.processSupervisor === supervisor,
      hasClock: typeof claudeOptions.clock.nowMs === "function",
      hasLogger: typeof claudeOptions.logger.log === "function",
    },
    xaiOptions: {
      enabled: xaiOptions.enabled,
      envIsProcessEnv: xaiOptions.env === process.env,
      supervisorMatches: xaiOptions.processSupervisor === supervisor,
    },
    successfulDisposalEvents,
    standaloneEvents,
    standaloneAuthorityHasAuth: standaloneAuthorityHooks.auth !== undefined,
    standaloneConsumerMethods: standaloneConsumerHooks.auth?.methods.length ?? -1,
    failedDisposalEvents: disposalEvents,
    primaryFailure,
  }),
)
