import type { CatalogPublisher } from "../core/adapter"
import { InvalidArgumentError, OperationCancelledError } from "../core/errors"
import type { ProviderSnapshot } from "../core/models"
import type { CatalogDraft, ModelV2Info, ProviderV2Info } from "./beta-api"

function assertNever(_value: never): never {
  throw new InvalidArgumentError("snapshot.status")
}

function defaultProviderApi(): ProviderV2Info["api"] {
  return {
    type: "aisdk",
    package: "opencode-ext-connector",
  }
}

function defaultModelFields(
  modelId: string,
): Omit<ModelV2Info, "id" | "providerID" | "name" | "family"> {
  return {
    api: {
      id: modelId,
      type: "aisdk",
      package: "opencode-ext-connector",
    },
    capabilities: {
      tools: true,
      input: ["text"],
      output: ["text"],
    },
    request: {
      headers: {},
      body: {},
    },
    variants: [],
    time: {
      released: 0,
    },
    cost: [],
    status: "active",
    enabled: true,
    limit: {
      context: 0,
      output: 0,
    },
  }
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
            provider.api = defaultProviderApi()
            provider.request = { headers: {}, body: {} }
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
              Object.assign(info, defaultModelFields(model.id))
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
