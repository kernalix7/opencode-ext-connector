import { AdapterError, OperationCancelledError } from "./errors.js"
import type { ProviderId } from "./ids.js"
import type { AsyncDisposableHandle } from "./lifecycle.js"
import type { ProviderSnapshot } from "./models.js"

export interface ProviderAdapter extends AsyncDisposableHandle {
  readonly providerId: ProviderId
  snapshot(signal: AbortSignal): Promise<ProviderSnapshot>
}

export interface CatalogPublisher {
  publish(snapshot: ProviderSnapshot, signal: AbortSignal): Promise<void>
}

export type RefreshProviderCatalogOptions = {
  readonly adapter: ProviderAdapter
  readonly publisher: CatalogPublisher
  readonly signal: AbortSignal
}

export async function refreshProviderCatalog(
  options: RefreshProviderCatalogOptions,
): Promise<ProviderSnapshot> {
  if (options.signal.aborted) {
    throw new OperationCancelledError("refresh-provider-catalog")
  }
  const snapshot = await options.adapter.snapshot(options.signal)
  if (snapshot.providerId !== options.adapter.providerId) {
    throw new AdapterError({
      operation: "snapshot-provider-mismatch",
      retryable: false,
      cause: null,
      providerId: options.adapter.providerId,
    })
  }
  if (options.signal.aborted) {
    throw new OperationCancelledError("refresh-provider-catalog")
  }
  await options.publisher.publish(snapshot, options.signal)
  return snapshot
}
