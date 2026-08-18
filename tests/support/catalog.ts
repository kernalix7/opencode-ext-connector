import type {
  CatalogDraft,
  CatalogProviderRecord,
  ModelV2Info,
  ProviderV2Info,
} from "../../src/opencode/beta-api"

function emptyProvider(id: string): ProviderV2Info {
  return {
    id,
    name: id,
    api: { type: "aisdk", package: "opencode-ext-connector" },
    request: { headers: {}, body: {} },
  }
}

function emptyModel(providerID: string, id: string): ModelV2Info {
  return {
    id,
    providerID,
    name: id,
    api: { id, type: "aisdk", package: "opencode-ext-connector" },
    capabilities: { tools: false, input: [], output: [] },
    request: { headers: {}, body: {} },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 0, output: 0 },
  }
}

export class MemoryCatalogDraft implements CatalogDraft {
  private readonly providers = new Map<string, ProviderV2Info>()
  private readonly models = new Map<string, Map<string, ModelV2Info>>()

  public readonly provider: CatalogDraft["provider"]
  public readonly model: CatalogDraft["model"]

  public constructor() {
    this.provider = {
      list: (): readonly CatalogProviderRecord[] =>
        [...this.providers.values()].map((provider) => ({
          provider,
          models: new Map(this.models.get(provider.id)),
        })),
      get: (providerID: string): CatalogProviderRecord | undefined => {
        const provider = this.providers.get(providerID)
        if (provider === undefined) {
          return undefined
        }
        return { provider, models: new Map(this.models.get(providerID)) }
      },
      update: (providerID: string, update: (provider: ProviderV2Info) => void): void => {
        const provider = this.providers.get(providerID) ?? emptyProvider(providerID)
        update(provider)
        this.providers.set(providerID, provider)
        if (!this.models.has(providerID)) {
          this.models.set(providerID, new Map())
        }
      },
      remove: (providerID: string): void => {
        this.providers.delete(providerID)
        this.models.delete(providerID)
      },
    }
    this.model = {
      get: (providerID: string, modelID: string): ModelV2Info | undefined =>
        this.models.get(providerID)?.get(modelID),
      update: (providerID: string, modelID: string, update: (model: ModelV2Info) => void): void => {
        const providerModels = this.models.get(providerID) ?? new Map<string, ModelV2Info>()
        const model = providerModels.get(modelID) ?? emptyModel(providerID, modelID)
        update(model)
        providerModels.set(modelID, model)
        this.models.set(providerID, providerModels)
        if (!this.providers.has(providerID)) {
          this.providers.set(providerID, emptyProvider(providerID))
        }
      },
      remove: (providerID: string, modelID: string): void => {
        this.models.get(providerID)?.delete(modelID)
      },
      default: {
        get: (): { providerID: string; modelID: string } | undefined => undefined,
        set: (_providerID: string, _modelID: string): void => undefined,
      },
    }
  }
}
