import type { ProviderAdapter } from "../../core/adapter"
import { OperationCancelledError } from "../../core/errors"
import { parseProviderId } from "../../core/ids"
import { createAsyncDisposable } from "../../core/lifecycle"
import type { AdapterModel, ProviderSnapshot } from "../../core/models"

export type CursorAdapterOptions = {
  readonly resolveAgent: (signal: AbortSignal) => Promise<string | null>
  readonly listModels: (agent: string, signal: AbortSignal) => Promise<readonly AdapterModel[]>
}

export function createCursorAdapter(options: CursorAdapterOptions): ProviderAdapter {
  const providerId = parseProviderId("cursor")
  const disposal = createAsyncDisposable(() => undefined)
  let lastModels: readonly AdapterModel[] | null = null
  return {
    providerId,
    snapshot: async (signal: AbortSignal): Promise<ProviderSnapshot> => {
      if (signal.aborted) {
        throw new OperationCancelledError("cursor-snapshot")
      }
      const agent = await options.resolveAgent(signal)
      if (agent === null) {
        return { status: "unavailable", providerId, reason: "process-error" }
      }
      try {
        const models = await options.listModels(agent, signal)
        if (models.length === 0) {
          return lastModels === null
            ? { status: "unavailable", providerId, reason: "invalid-data" }
            : { status: "stale", providerId, models: lastModels, reason: "invalid-data" }
        }
        lastModels = models
        return { status: "ready", providerId, models }
      } catch {
        return lastModels === null
          ? { status: "unavailable", providerId, reason: "process-error" }
          : { status: "stale", providerId, models: lastModels, reason: "process-error" }
      }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
