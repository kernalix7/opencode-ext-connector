import type { ProviderAdapter } from "../core/adapter.js"
import { OperationCancelledError } from "../core/errors.js"
import { PluginV2ClientError } from "./beta-api.js"
import type { HealthStore } from "./health-refresh.js"
import { scheduleCatalogReload } from "./reload.js"
import { createV2Capture } from "./v2-capture.js"
import type { V2RefreshOptions } from "./v2-refresh-types.js"

export type { V2RefreshOptions } from "./v2-refresh-types.js"

const catalogEvents = [
  "credential.switched",
  "credential.updated",
  "integration.updated",
  "provider.updated",
] as const

export type V2RefreshController = {
  readonly refresh: () => Promise<void>
  readonly disposeReload: () => Promise<void>
  readonly disposeAdapters: () => Promise<void>
  readonly finishWatch: () => Promise<void>
}

function isCatalogEvent(type: string): boolean {
  return catalogEvents.some((event) => event === type)
}

export function createV2RefreshController(options: V2RefreshOptions): V2RefreshController {
  const adapters = new Map<string, ProviderAdapter>()
  const healthStore: HealthStore = new Map()
  let pending = false
  let running: Promise<void> | undefined
  let watchError: unknown
  let drainFlight: Promise<void> | undefined
  const isShutdownCancellation = (error: unknown): boolean => {
    if (!options.lifetime.aborted) return false
    if (error instanceof OperationCancelledError) return true
    return error instanceof DOMException && error.name === "AbortError"
  }
  const retainRefreshFailure = (error: unknown): void => {
    if (isShutdownCancellation(error) || watchError !== undefined) return
    watchError = error
    options.logger.log("warn", "v2.catalog.refresh-failed", {
      name: error instanceof Error ? error.name : "unknown",
    })
  }
  const observeRefresh = (operation: Promise<void>): void => {
    void operation.then(() => undefined, retainRefreshFailure)
  }
  const drainRefresh = (): Promise<void> => {
    if (drainFlight !== undefined) return drainFlight
    const current = running
    if (current === undefined) return Promise.resolve()
    drainFlight = current
      .then(() => undefined, retainRefreshFailure)
      .finally(() => {
        drainFlight = undefined
      })
    return drainFlight
  }
  const capture = createV2Capture(options, { adapters, healthStore })
  const refresh = (): Promise<void> => {
    pending = true
    if (running !== undefined) return running
    running = (async (): Promise<void> => {
      while (pending && !options.lifetime.aborted) {
        pending = false
        await capture()
      }
    })().finally(() => {
      running = undefined
    })
    return running
  }
  const watching = (async (): Promise<void> => {
    try {
      for await (const event of options.subscribe(options.lifetime)) {
        if (options.lifetime.aborted) return
        if (isCatalogEvent(event.type)) observeRefresh(refresh())
      }
    } catch (error: unknown) {
      if (options.lifetime.aborted) return
      if (error instanceof DOMException && error.name === "AbortError") return
      if (error instanceof PluginV2ClientError) return
      if (watchError === undefined) watchError = error
      options.logger.log("warn", "v2.catalog.watch-failed", {
        name: error instanceof Error ? error.name : "unknown",
      })
    }
  })()
  const reload = scheduleCatalogReload({
    clock: options.clock,
    intervalMs: options.catalogReloadMs,
    reload: refresh,
  })
  return {
    refresh,
    disposeReload: () => reload.dispose(),
    disposeAdapters: async (): Promise<void> => {
      await drainRefresh()
      const results = await Promise.allSettled(
        [...adapters.values()].map((adapter) => Promise.resolve().then(() => adapter.dispose())),
      )
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )
      if (failure !== undefined) throw failure.reason
    },
    finishWatch: async (): Promise<void> => {
      await watching
      await drainRefresh()
      if (watchError !== undefined) throw watchError
    },
  }
}
