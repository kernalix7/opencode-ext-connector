import type { AuthHook } from "@opencode-ai/plugin"
import { z } from "zod"
import { OperationCancelledError } from "../core/errors.js"
import { createSdkFetch } from "../http/sdk-fetch.js"
import { createClaudeVersionResolver } from "../providers/claude/cli-version.js"
import { createClaudeCompatibilityFetch } from "../providers/claude/compat-request.js"
import type { OpenCodeAuthMatch } from "./auth-store.js"
import type { ProviderEntryDeps } from "./provider-entry.js"
import { createSubscriptionScope, sameSubscription } from "./subscription-scope.js"

type Loader = NonNullable<AuthHook["loader"]>
const nativeBodySchema = z.object({ model: z.string() }).passthrough()

function matchesNativeGate(
  auth: Awaited<ReturnType<Parameters<Loader>[0]>>,
  gate: OpenCodeAuthMatch | null,
): boolean {
  switch (auth.type) {
    case "oauth":
      return gate?.kind === "oauth" && gate.key === auth.access
    case "api":
      return auth.key === "cli-session:anthropic" && gate?.kind === "marker"
    case "wellknown":
      return false
    default:
      auth satisfies never
      throw new TypeError("Unsupported native auth variant")
  }
}

export function createScopedClaudeLoader(deps: ProviderEntryDeps): {
  readonly loader: Loader
  readonly dispose: () => Promise<void>
} {
  const lifetime = new AbortController()
  const scope = createSubscriptionScope(deps)
  const readVersion = createClaudeVersionResolver({ env: deps.env, transport: deps.transport })
  let cleanup: Promise<void> | undefined
  return {
    loader: async (getAuth, provider) => {
      if (lifetime.signal.aborted) return {}
      const auth = await getAuth()
      if (!matchesNativeGate(auth, await deps.authStore.matchAuth("claude"))) return {}
      const initial = await scope.observe("claude", lifetime.signal)
      if (initial === null || lifetime.signal.aborted) return {}
      if (!matchesNativeGate(auth, initial.gate)) return {}
      const models = new Set(Object.keys(provider.models))
      if (models.size === 0) return {}
      const authorizeRequest = (input: string | URL | Request, init?: RequestInit): void => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (
          url.origin !== "https://api.anthropic.com" ||
          url.pathname !== "/v1/messages" ||
          url.username !== "" ||
          url.password !== ""
        ) {
          throw new OperationCancelledError("claude-native-request")
        }
        const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null
        const parsed = nativeBodySchema.safeParse(body)
        if (
          !parsed.success ||
          !models.has(parsed.data.model) ||
          !(parsed.data.model in provider.models)
        ) {
          throw new OperationCancelledError("claude-native-model")
        }
      }
      const check = async (signal: AbortSignal): Promise<string> => {
        if (signal.aborted || lifetime.signal.aborted)
          throw new OperationCancelledError("claude-native-loader")
        const selected = await getAuth()
        if (!matchesNativeGate(selected, await deps.authStore.matchAuth("claude"))) {
          throw new OperationCancelledError("claude-native-loader")
        }
        const current = await scope.observe("claude", signal)
        if (
          signal.aborted ||
          lifetime.signal.aborted ||
          current === null ||
          !sameSubscription(initial, current) ||
          !matchesNativeGate(selected, current.gate)
        ) {
          throw new OperationCancelledError("claude-native-loader")
        }
        return current.token
      }
      const sdkFetch = createSdkFetch(deps.transport)
      const compatibilityFetch = createClaudeCompatibilityFetch({
        readVersion,
        readAccessToken: check,
        forceRefreshAccessToken: async (signal) => {
          await check(signal)
          await scope.forceClaude(signal)
          return check(signal)
        },
        fetch: Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            const signal =
              init?.signal ??
              (input instanceof Request ? input.signal : new AbortController().signal)
            authorizeRequest(input, init)
            const token = await check(signal)
            const headers = new Headers(init?.headers)
            headers.set("authorization", `Bearer ${token}`)
            headers.delete("x-api-key")
            return sdkFetch(input, {
              ...init,
              signal: AbortSignal.any([signal, lifetime.signal]),
              headers,
            })
          },
          { preconnect: sdkFetch.preconnect },
        ),
      })
      const fetch = Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          authorizeRequest(input, init)
          const caller =
            init?.signal ?? (input instanceof Request ? input.signal : new AbortController().signal)
          return compatibilityFetch(input, {
            ...init,
            signal: AbortSignal.any([caller, lifetime.signal]),
          })
        },
        { preconnect: compatibilityFetch.preconnect },
      )
      return { apiKey: "", baseURL: "https://api.anthropic.com/v1", fetch }
    },
    dispose: () => {
      if (cleanup !== undefined) return cleanup
      lifetime.abort()
      cleanup = scope.dispose()
      return cleanup
    },
  }
}
