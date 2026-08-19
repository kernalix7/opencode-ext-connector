import type { CatalogPublisher, ProviderAdapter } from "../core/adapter"
import { refreshProviderCatalog } from "../core/adapter"
import type { Clock } from "../core/clock"
import { createDeadline } from "../core/deadline"
import { ConnectorError } from "../core/errors"
import {
  createInitialHealthState,
  type HealthPolicy,
  type HealthState,
  reduceHealth,
} from "../core/health"
import type { ProviderId } from "../core/ids"
import type { ConnectorLogger } from "../core/logger"

export type HealthStore = Map<ProviderId, HealthState>

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "unknown"
}

export async function refreshAdaptersWithHealth(options: {
  readonly adapters: readonly ProviderAdapter[]
  readonly publisher: CatalogPublisher
  readonly logger: ConnectorLogger
  readonly clock: Clock
  readonly health: HealthPolicy
  readonly store: HealthStore
  readonly signal: AbortSignal
  readonly snapshotTimeoutMs?: number
}): Promise<void> {
  const nowMs = options.clock.nowMs()
  for (const adapter of options.adapters) {
    const current = options.store.get(adapter.providerId) ?? createInitialHealthState()
    if (current.retryAtMs !== null && nowMs < current.retryAtMs) {
      options.logger.log("debug", "provider.snapshot.deferred", {
        providerId: adapter.providerId,
        retryAtMs: current.retryAtMs,
      })
      continue
    }
    const deadline = createDeadline({
      clock: options.clock,
      timeoutMs: options.snapshotTimeoutMs ?? 30_000,
      parentSignal: options.signal,
    })
    try {
      const snapshot = await refreshProviderCatalog({
        adapter,
        publisher: options.publisher,
        signal: deadline.signal,
      })
      const status = snapshot.status === "ready" ? "ready" : snapshot.status
      options.store.set(
        adapter.providerId,
        reduceHealth(current, { status, atMs: nowMs }, options.health),
      )
    } catch (error: unknown) {
      options.store.set(
        adapter.providerId,
        reduceHealth(current, { status: "unavailable", atMs: nowMs }, options.health),
      )
      const retryable = error instanceof ConnectorError ? error.retryable : false
      options.logger.log("warn", "provider.snapshot.failed", {
        providerId: adapter.providerId,
        retryable,
        message: errorMessage(error),
      })
    } finally {
      await deadline.dispose()
    }
  }
}
