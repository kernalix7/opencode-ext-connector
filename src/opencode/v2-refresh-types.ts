import type { Clock } from "../core/clock.js"
import type { HealthPolicy } from "../core/health.js"
import type { ConnectorLogger } from "../core/logger.js"
import type { ProviderEntry, ProviderEntryDeps } from "./provider-entry.js"
import type { SubscriptionScope } from "./subscription-scope.js"
import type { V2ConnectionSource } from "./v2-auth.js"
import type { V2Catalog } from "./v2-catalog.js"

export type V2RefreshOptions = {
  readonly entries: readonly ProviderEntry[]
  readonly deps: ProviderEntryDeps
  readonly connection: V2ConnectionSource
  readonly catalog: V2Catalog
  readonly clock: Clock
  readonly logger: ConnectorLogger
  readonly health: HealthPolicy
  readonly snapshotTimeoutMs: number
  readonly catalogReloadMs: number
  readonly lifetime: AbortSignal
  readonly reloadProviders: () => Promise<void>
  readonly subscribe: (signal: AbortSignal) => AsyncIterable<{ readonly type: string }>
  readonly scope: SubscriptionScope
}
