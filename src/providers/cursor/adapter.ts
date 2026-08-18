import type { ProviderAdapter } from "../../core/adapter"
import { OperationCancelledError } from "../../core/errors"
import { parseProviderId } from "../../core/ids"
import { createAsyncDisposable } from "../../core/lifecycle"
import type { AdapterModel, ProviderSnapshot } from "../../core/models"

export type CursorAdapterOptions = {
  readonly resolveAgent: (signal: AbortSignal) => Promise<string | null>
  readonly models: readonly AdapterModel[]
}

export function createCursorAdapter(options: CursorAdapterOptions): ProviderAdapter {
  const providerId = parseProviderId("cursor")
  const disposal = createAsyncDisposable(() => undefined)
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
      return { status: "ready", providerId, models: options.models }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
