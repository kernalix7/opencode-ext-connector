import type { Clock } from "../core/clock.js"
import type { HttpTransport } from "../core/http.js"
import { createAsyncDisposable } from "../core/lifecycle.js"
import type { ConnectorLogger } from "../core/logger.js"
import { parseConnectorOptions } from "../core/options.js"
import { createFetchHttpTransport } from "../http/fetch-transport.js"
import type { ClaudeAuthLookup } from "../providers/claude/auth.js"
import type { OllamaFetch } from "../providers/ollama/http.js"
import type { PluginV2Context } from "./beta-api.js"
import { startClaudeOwnerAuthority } from "./claude-authority.js"
import { pickConnectorOptionsInput, pickOllamaBaseURL } from "./host-options.js"
import { createProviderRegistry, selectConfiguredProviders } from "./providers.js"
import { createSubscriptionScope } from "./subscription-scope.js"
import { createV2AuthStore, registerV2IntegrationMethods } from "./v2-auth.js"
import { createV2Catalog } from "./v2-catalog.js"
import { registerV2LanguageHooks, type V2ModelHook } from "./v2-language.js"
import { createV2RefreshController } from "./v2-refresh.js"
import { createProductionClock, createV2Logger, resolveV2OllamaBundle } from "./v2-resources.js"

export type V2SetupDependencies = {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly clock?: Clock
  readonly createTransport?: () => HttpTransport
  readonly createLogger?: (clock: Clock) => ConnectorLogger
  readonly ollamaFetch?: OllamaFetch
  readonly claudeAuthLookup?: ClaudeAuthLookup
}

type Cleanup = () => Promise<void>

async function settle(steps: readonly (() => Promise<void>)[]): Promise<void> {
  const results = await Promise.allSettled(steps.map((step) => Promise.resolve().then(step)))
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
  if (failure !== undefined) throw failure.reason
}

export type V2HostContext = {
  readonly options: PluginV2Context["options"]
  readonly integration: Pick<PluginV2Context["integration"], "transform" | "connection">
  readonly provider: Pick<PluginV2Context["provider"], "transform" | "reload">
  readonly aisdk: {
    readonly hook: V2ModelHook
  }
  readonly event: {
    readonly subscribe: (options?: {
      readonly signal?: AbortSignal
    }) => AsyncIterable<{ readonly type: string }>
  }
}

export async function setupV2Connector(
  context: V2HostContext,
  dependencies: V2SetupDependencies = {},
): Promise<Cleanup> {
  const connectorOptions = parseConnectorOptions(pickConnectorOptionsInput(context.options))
  const lifetime = new AbortController()
  const owned: {
    reload?: () => Promise<void>
    adapters?: () => Promise<void>
    hooks: Array<() => Promise<void>>
    watch?: () => Promise<void>
  } = { hooks: [] }
  const cleanup = async (): Promise<void> => {
    lifetime.abort()
    const steps = [owned.reload, owned.adapters, ...owned.hooks, owned.watch].flatMap((step) =>
      step === undefined ? [] : [step],
    )
    await settle(steps)
  }
  const disposal = createAsyncDisposable(cleanup)
  try {
    const env = dependencies.env ?? process.env
    const clock = dependencies.clock ?? createProductionClock()
    const transport = dependencies.createTransport?.() ?? createFetchHttpTransport()
    const logger = dependencies.createLogger?.(clock) ?? createV2Logger(clock)
    const authority = startClaudeOwnerAuthority({
      authority: connectorOptions.credentialAuthority,
      env,
      clock,
      logger,
      ...(dependencies.claudeAuthLookup === undefined
        ? {}
        : { lookup: dependencies.claudeAuthLookup }),
    })
    owned.hooks.push(authority.dispose)
    const ollama = connectorOptions.providers.includes("ollama")
      ? resolveV2OllamaBundle(pickOllamaBaseURL(context.options), dependencies.ollamaFetch)
      : undefined
    const entries = selectConfiguredProviders(
      createProviderRegistry({
        ...(ollama === undefined
          ? {}
          : {
              ollama: { fetch: ollama.fetch, catalog: ollama.catalog, endpoints: ollama.endpoints },
            }),
      }),
      connectorOptions.providers,
    )
    const authStore = createV2AuthStore({ connection: context.integration.connection, entries })
    const deps = {
      env,
      transport,
      clock,
      authStore,
      allowEnvironmentKeys: false,
      credentialRefresh: connectorOptions.credentialRefresh,
      writeBackCredentials: connectorOptions.writeBackCredentials,
      ...(dependencies.claudeAuthLookup === undefined
        ? {}
        : { claudeAuthLookup: dependencies.claudeAuthLookup }),
    }
    const scope = createSubscriptionScope(deps)
    owned.hooks.push(scope.dispose)
    const catalog = createV2Catalog(entries)
    const integrationRegistration = await context.integration.transform((editor) => {
      registerV2IntegrationMethods(entries, editor)
    })
    owned.hooks.push(() => integrationRegistration.dispose())
    const providerRegistration = await context.provider.transform((editor) => {
      catalog.apply(editor)
    })
    owned.hooks.push(() => providerRegistration.dispose())
    const languageRegistrations = await registerV2LanguageHooks(context.aisdk.hook, {
      deps,
      scope,
      matchesSource: async (providerId, signal) => {
        if (providerId !== "claude" && providerId !== "command-code") return null
        const current = await scope.observe(providerId, signal)
        if (!catalog.matchesSource(providerId, current)) {
          catalog.forget(providerId)
          return null
        }
        return current?.token ?? null
      },
      ...(ollama === undefined ? {} : { ollamaRuntime: ollama.runtime }),
      hasModel: catalog.hasModel,
      generation: catalog.generation,
      isConnected: (providerId) => {
        if (lifetime.signal.aborted) return Promise.resolve(false)
        const entry = entries.find((candidate) => candidate.id === providerId)
        if (entry === undefined) return Promise.resolve(false)
        return (async () => {
          const match = await authStore.matchAuth(
            entry.id === "ollama" ? "ollama" : entry.id === "claude" ? "claude" : "command-code",
          )
          if (entry.id === "ollama" && !catalog.matchesConnection(entry.id, match)) return false
          if (entry.id === "ollama") return entry.isConnected(deps)
          const current = await scope.observe(
            entry.id === "claude" ? "claude" : "command-code",
            lifetime.signal,
          )
          if (catalog.matchesSource(entry.id, current)) return true
          catalog.forget(entry.id)
          return false
        })()
      },
      providerIds: entries.map((entry) => entry.id),
      lifetime: lifetime.signal,
    })
    for (const registration of languageRegistrations) owned.hooks.push(() => registration.dispose())
    const refresher = createV2RefreshController({
      entries,
      deps,
      scope,
      connection: context.integration.connection,
      catalog,
      clock,
      logger,
      health: connectorOptions.health,
      snapshotTimeoutMs: connectorOptions.snapshotTimeoutMs,
      catalogReloadMs: connectorOptions.catalogReloadMs,
      lifetime: lifetime.signal,
      reloadProviders: () => context.provider.reload(),
      subscribe: (signal) => context.event.subscribe({ signal }),
    })
    owned.reload = refresher.disposeReload
    owned.adapters = refresher.disposeAdapters
    owned.watch = refresher.finishWatch
    await refresher.refresh()
    return disposal.dispose
  } catch (error: unknown) {
    await Promise.allSettled([disposal.dispose()])
    throw error
  }
}
