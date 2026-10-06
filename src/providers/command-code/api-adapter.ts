import type { ProviderAdapter } from "../../core/adapter.js"
import { OperationCancelledError } from "../../core/errors.js"
import { parseProviderId } from "../../core/ids.js"
import { createAsyncDisposable } from "../../core/lifecycle.js"
import type { AdapterModel, ProviderSnapshot } from "../../core/models.js"

export function createCommandCodeAdapter(options: {
  readonly readApiKey: (signal: AbortSignal) => Promise<string | null>
  readonly listModels: (key: string, signal: AbortSignal) => Promise<readonly AdapterModel[]>
}): ProviderAdapter {
  const providerId = parseProviderId("command-code")
  const disposal = createAsyncDisposable(() => undefined)
  let cachedKey: string | null = null
  let cachedModels: readonly AdapterModel[] | null = null
  return {
    providerId,
    snapshot: async (signal: AbortSignal): Promise<ProviderSnapshot> => {
      if (signal.aborted) throw new OperationCancelledError("command-code-snapshot")
      const key = await options.readApiKey(signal)
      if (signal.aborted) throw new OperationCancelledError("command-code-snapshot")
      if (key !== cachedKey) {
        cachedKey = key
        cachedModels = null
      }
      if (key === null || key.trim().length === 0) {
        cachedKey = null
        cachedModels = null
        return { status: "unavailable", providerId, reason: "invalid-data" }
      }
      try {
        const models = await options.listModels(key, signal)
        if (signal.aborted) throw new OperationCancelledError("command-code-snapshot")
        if (models.length === 0) {
          return { status: "unavailable", providerId, reason: "invalid-data" }
        }
        cachedModels = models
        return { status: "ready", providerId, models }
      } catch (error) {
        if (signal.aborted) throw new OperationCancelledError("command-code-snapshot")
        if (error instanceof OperationCancelledError) throw error
        return cachedModels === null
          ? { status: "unavailable", providerId, reason: "transport-error" }
          : { status: "stale", providerId, models: cachedModels, reason: "transport-error" }
      }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
