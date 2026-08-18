import type { CatalogPublisher } from "../core/adapter"
import { InvalidArgumentError, OperationCancelledError } from "../core/errors"
import type { ProviderSnapshot } from "../core/models"
import type { CatalogDraft } from "./beta-api"

function assertNever(_value: never): never {
  throw new InvalidArgumentError("snapshot.status")
}

export function createCatalogPublisher(draft: CatalogDraft): CatalogPublisher {
  return {
    publish: async (snapshot: ProviderSnapshot, signal: AbortSignal): Promise<void> => {
      if (signal.aborted) {
        throw new OperationCancelledError("publish-catalog")
      }
      const providerId = snapshot.providerId
      switch (snapshot.status) {
        case "unavailable":
          draft.provider.remove(providerId)
          return
        case "ready":
        case "stale": {
          draft.provider.update(providerId, (provider) => {
            provider.id = providerId
            provider.name = providerId
            provider.disabled = false
          })
          const nextIds = new Set<string>(snapshot.models.map((model) => model.id))
          const existing = draft.provider.get(providerId)
          if (existing !== undefined) {
            for (const modelId of existing.models.keys()) {
              if (!nextIds.has(modelId)) {
                draft.model.remove(providerId, modelId)
              }
            }
          }
          for (const model of snapshot.models) {
            draft.model.update(providerId, model.id, (info) => {
              info.id = model.id
              info.providerID = providerId
              info.name = model.id
              info.enabled = true
            })
          }
          return
        }
        default:
          assertNever(snapshot)
      }
    },
  }
}
