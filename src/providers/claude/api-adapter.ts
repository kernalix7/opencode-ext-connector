import type { ProviderAdapter } from "../../core/adapter.js"
import { OperationCancelledError } from "../../core/errors.js"
import { parseProviderId } from "../../core/ids.js"
import { createAsyncDisposable } from "../../core/lifecycle.js"
import type { AdapterModel, ProviderSnapshot } from "../../core/models.js"

export type ClaudeApiAdapterOptions = {
  readonly readApiKey: (signal: AbortSignal) => Promise<string | null>
  readonly listModels: (key: string, signal: AbortSignal) => Promise<readonly AdapterModel[]>
}

export function createClaudeAdapter(options: ClaudeApiAdapterOptions): ProviderAdapter {
  const providerId = parseProviderId("claude")
  const disposal = createAsyncDisposable(() => undefined)
  let cachedKey: string | null = null
  let cachedModels: readonly AdapterModel[] | null = null
  return {
    providerId,
    snapshot: async (signal: AbortSignal): Promise<ProviderSnapshot> => {
      if (signal.aborted) throw new OperationCancelledError("claude-snapshot")
      const key = await options.readApiKey(signal)
      if (signal.aborted) throw new OperationCancelledError("claude-snapshot")
      if (key !== cachedKey) {
        cachedKey = key
        cachedModels = null
      }
      if (!key) {
        return { status: "unavailable", providerId, reason: "invalid-data" }
      }
      try {
        const models = await options.listModels(key, signal)
        if (signal.aborted) throw new OperationCancelledError("claude-snapshot")
        if (models.length === 0) {
          return cachedKey === key && cachedModels !== null
            ? { status: "stale", providerId, models: cachedModels, reason: "invalid-data" }
            : { status: "unavailable", providerId, reason: "invalid-data" }
        }
        if (cachedKey === key) cachedModels = models
        return { status: "ready", providerId, models }
      } catch (error) {
        if (signal.aborted || error instanceof OperationCancelledError) {
          throw new OperationCancelledError("claude-snapshot")
        }
        return cachedKey === key && cachedModels !== null
          ? { status: "stale", providerId, models: cachedModels, reason: "transport-error" }
          : { status: "unavailable", providerId, reason: "transport-error" }
      }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
