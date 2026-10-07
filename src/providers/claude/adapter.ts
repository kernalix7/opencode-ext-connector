import type { ProviderAdapter } from "../../core/adapter.js"
import { OperationCancelledError, ResourceDisposedError } from "../../core/errors.js"
import { parseProviderId } from "../../core/ids.js"
import { createAsyncDisposable } from "../../core/lifecycle.js"
import type { AdapterModel, ProviderSnapshot } from "../../core/models.js"

export type ClaudeAdapterOptions = {
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly listModels: (token: string, signal: AbortSignal) => Promise<readonly AdapterModel[]>
}

export function createClaudeAdapter(options: ClaudeAdapterOptions): ProviderAdapter {
  const providerId = parseProviderId("claude")
  let disposed = false
  const disposal = createAsyncDisposable(() => {
    disposed = true
    cachedModels = null
    cachedToken = null
  })
  let cachedToken: string | null = null
  let cachedModels: readonly AdapterModel[] | null = null
  const ensureActive = (signal: AbortSignal): void => {
    if (signal.aborted) throw new OperationCancelledError("claude-snapshot")
    if (disposed) throw new ResourceDisposedError("claude-adapter")
  }
  return {
    providerId,
    snapshot: async (signal: AbortSignal): Promise<ProviderSnapshot> => {
      ensureActive(signal)
      const token = await options.readAccessToken(signal)
      ensureActive(signal)
      if (token !== cachedToken) {
        cachedToken = token
        cachedModels = null
      }
      if (!token) return { status: "unavailable", providerId, reason: "invalid-data" }
      try {
        const models = await options.listModels(token, signal)
        ensureActive(signal)
        if (token !== cachedToken)
          return { status: "unavailable", providerId, reason: "invalid-data" }
        if (models.length === 0)
          return cachedModels === null
            ? { status: "unavailable", providerId, reason: "invalid-data" }
            : { status: "stale", providerId, models: cachedModels, reason: "invalid-data" }
        cachedModels = models
        return { status: "ready", providerId, models }
      } catch (error) {
        ensureActive(signal)
        if (error instanceof OperationCancelledError || error instanceof ResourceDisposedError)
          throw error
        return token === cachedToken && cachedModels !== null
          ? { status: "stale", providerId, models: cachedModels, reason: "transport-error" }
          : { status: "unavailable", providerId, reason: "transport-error" }
      }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
