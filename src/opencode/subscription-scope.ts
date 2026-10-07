import { type ClaudeTokenManager, createClaudeTokenManager } from "../providers/claude/auth.js"
import { writeClaudeCredentials } from "../providers/claude/writeback.js"
import { readCommandCodeCredentialSource } from "../providers/command-code/auth.js"
import type { OpenCodeAuthMatch, OpenCodeAuthProvider } from "./auth-store.js"
import type { ProviderEntryDeps } from "./provider-entry.js"

export type SubscriptionObservation = {
  readonly gate: OpenCodeAuthMatch
  readonly token: string
  readonly sourceIdentity: string
  readonly lineageId?: string
}

export type SubscriptionScope = {
  readonly observe: (
    provider: OpenCodeAuthProvider,
    signal: AbortSignal,
  ) => Promise<SubscriptionObservation | null>
  readonly forceClaude: (signal: AbortSignal) => Promise<string | null>
  readonly dispose: () => Promise<void>
}

export function sameSubscription(
  left: SubscriptionObservation,
  right: SubscriptionObservation,
): boolean {
  return (
    left.gate.kind === right.gate.kind &&
    left.gate.connectionId === right.gate.connectionId &&
    (left.gate.kind !== "api-key" ||
      (right.gate.kind === "api-key" && left.gate.key === right.gate.key)) &&
    (left.gate.kind !== "oauth" ||
      (right.gate.kind === "oauth" &&
        (left.gate.key === right.gate.key ||
          (left.lineageId === right.lineageId && right.gate.key === right.token)))) &&
    left.sourceIdentity === right.sourceIdentity &&
    (left.lineageId === undefined ? left.token === right.token : left.lineageId === right.lineageId)
  )
}

export function createSubscriptionScope(deps: ProviderEntryDeps): SubscriptionScope {
  const manager: ClaudeTokenManager = createClaudeTokenManager({
    env: deps.env,
    clock: deps.clock,
    transport: deps.transport,
    ...(deps.claudeAuthLookup === undefined ? {} : { lookup: deps.claudeAuthLookup }),
    ...(deps.credentialRefresh === undefined ? {} : { refresh: deps.credentialRefresh }),
    writeBackEnabled: deps.writeBackCredentials === true,
    writeBack: async (credentials, previous) => {
      await writeClaudeCredentials(deps.env, credentials, {
        enabled: true,
        source: previous.sourceIdentity.startsWith("keychain:") ? "keychain" : "file",
        expectedPriorAccessToken: previous.credentials.accessToken,
      })
    },
  })
  return {
    observe: async (provider, signal) => {
      const gate = await deps.authStore.matchAuth(provider)
      if (gate === null) return null
      if (provider === "claude") {
        if (gate.kind !== "oauth" && gate.kind !== "marker") return null
        const source = await manager.readCredentialObservation(signal)
        if (source === null) return null
        return {
          gate,
          token: source.credentials.accessToken,
          sourceIdentity: source.sourceIdentity,
          lineageId: source.lineageId,
        }
      }
      if (provider !== "command-code") return null
      if (gate.kind === "api-key")
        return { gate, token: gate.key, sourceIdentity: "selected-connection" }
      const source = await readCommandCodeCredentialSource(deps.env, signal)
      return gate.kind !== "marker" || source === null
        ? null
        : {
            gate,
            token: source.accessToken,
            sourceIdentity: source.sourceIdentity,
          }
    },
    forceClaude: manager.forceRefreshAccessToken,
    dispose: manager.dispose,
  }
}
