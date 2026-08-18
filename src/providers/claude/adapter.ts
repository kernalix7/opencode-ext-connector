import type { ProviderAdapter } from "../../core/adapter"
import { OperationCancelledError } from "../../core/errors"
import { parseProviderId } from "../../core/ids"
import { createAsyncDisposable } from "../../core/lifecycle"
import type { AdapterModel, ProviderSnapshot } from "../../core/models"

export type ClaudeAdapterOptions = {
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly models: readonly AdapterModel[]
}

export function createClaudeAdapter(options: ClaudeAdapterOptions): ProviderAdapter {
  const providerId = parseProviderId("claude")
  const disposal = createAsyncDisposable(() => undefined)
  return {
    providerId,
    snapshot: async (signal: AbortSignal): Promise<ProviderSnapshot> => {
      if (signal.aborted) {
        throw new OperationCancelledError("claude-snapshot")
      }
      const token = await options.readAccessToken(signal)
      if (token === null) {
        return { status: "unavailable", providerId, reason: "invalid-data" }
      }
      return { status: "ready", providerId, models: options.models }
    },
    dispose: disposal.dispose,
    [Symbol.asyncDispose]: disposal[Symbol.asyncDispose],
  }
}
