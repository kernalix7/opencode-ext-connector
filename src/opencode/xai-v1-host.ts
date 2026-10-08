import type { Hooks } from "@opencode-ai/plugin"

import type { Clock } from "../core/clock.js"
import { createAsyncDisposable } from "../core/lifecycle.js"
import type { ProcessSupervisor } from "../core/process.js"
import { createProductionProcessSupervisor } from "../process/production-supervisor.js"
import { createXaiAuthorityObserver } from "../providers/xai/authority-observer.js"
import { createXaiConsumerAuth, type NetworkFetch } from "../providers/xai/consumer-auth.js"

type XaiHostDependencies = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly clock: Clock
}

export async function startV1XaiAuthority(
  options: XaiHostDependencies & { readonly createSupervisor?: () => ProcessSupervisor },
): Promise<{ readonly dispose: () => Promise<void> }> {
  const supervisor = (options.createSupervisor ?? createProductionProcessSupervisor)()
  let observer: ReturnType<typeof createXaiAuthorityObserver> | undefined
  const disposal = createAsyncDisposable(async () => {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => observer?.dispose()),
      Promise.resolve().then(() => supervisor.dispose()),
    ])
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    if (failure !== undefined) throw failure.reason
  })
  try {
    observer = createXaiAuthorityObserver({
      env: options.env,
      clock: options.clock,
      enabled: true,
      processSupervisor: supervisor,
    })
  } catch (error: unknown) {
    await Promise.allSettled([disposal.dispose()])
    throw error
  }
  return disposal
}

export function buildV1XaiConsumerHooks(
  options: XaiHostDependencies & { readonly networkFetch: NetworkFetch },
): Hooks {
  const { dispose, loader, provider, methods } = createXaiConsumerAuth(options)
  return {
    auth: {
      provider,
      methods,
      loader: async (getAuth) => {
        const selected = await loader(getAuth)
        if (selected.fetch === undefined) return {}
        return {
          apiKey: selected.apiKey,
          fetch: Object.assign(selected.fetch, { preconnect: (): void => undefined }),
        }
      },
    },
    dispose,
  }
}
