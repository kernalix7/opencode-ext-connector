import type { ProviderAdapter } from "../../core/adapter.js"
import { OperationCancelledError } from "../../core/errors.js"
import { parseProviderId } from "../../core/ids.js"
import { createAsyncDisposable } from "../../core/lifecycle.js"
import type { AdapterModel, ProviderSnapshot } from "../../core/models.js"

export type CommandCodeAdapterOptions = {
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly listModels: (token: string, signal: AbortSignal) => Promise<readonly AdapterModel[]>
}

export function createCommandCodeAdapter(options: CommandCodeAdapterOptions): ProviderAdapter {
  const providerId = parseProviderId("command-code")
  const disposal = createAsyncDisposable(() => undefined)
  let lastModels: readonly AdapterModel[] | null = null
  return {
    providerId,
    snapshot: async (signal: AbortSignal): Promise<ProviderSnapshot> => {
      if (signal.aborted) {
        throw new OperationCancelledError("command-code-snapshot")
      }
      const token = await options.readAccessToken(signal)
      if (token === null) {
        return { status: "unavailable", providerId, reason: "invalid-data" }
      }
      try {
        const models = await options.listModels(token, signal)
        if (models.length === 0) {
          return lastModels === null
            ? { status: "unavailable", providerId, reason: "invalid-data" }
            : { status: "stale", providerId, models: lastModels, reason: "invalid-data" }
        }
        lastModels = models
        return { status: "ready", providerId, models }
      } catch {
        return lastModels === null
          ? { status: "unavailable", providerId, reason: "transport-error" }
          : { status: "stale", providerId, models: lastModels, reason: "transport-error" }
      }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
