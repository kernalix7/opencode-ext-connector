import type { Hooks } from "@opencode-ai/plugin"

import type { CatalogPublisher } from "../core/adapter.js"
import { InvalidArgumentError, OperationCancelledError } from "../core/errors.js"
import type { ProviderSnapshot } from "../core/models.js"
import type { ProviderEntry } from "./provider-entry.js"

type HostConfig = Parameters<NonNullable<Hooks["config"]>>[0]
type ProviderModels = {
  readonly [modelId: string]: {
    readonly id: string
    readonly name: string
  }
}

export type V1CatalogProjector = {
  readonly publisher: CatalogPublisher
  readonly attach: (config: HostConfig) => void
}

function assertNever(_value: never): never {
  throw new InvalidArgumentError("snapshot.status")
}

function modelRecord(snapshot: ProviderSnapshot, entry: ProviderEntry): ProviderModels {
  const models: { [modelId: string]: { readonly id: string; readonly name: string } } = {}
  const ids = snapshot.status === "unavailable" ? [] : snapshot.models.map((model) => model.id)
  const selected = ids.length === 0 ? (entry.fallbackModelIds ?? []) : ids
  for (const id of selected) {
    Object.defineProperty(models, id, {
      value: { id, name: id },
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return models
}

export function createV1CatalogProjector(options: {
  readonly entries: readonly ProviderEntry[]
  readonly npmSpecifiers?: Readonly<Record<string, string>>
}): V1CatalogProjector {
  const entries = new Map(options.entries.map((entry) => [entry.id, entry]))
  const modelsByProvider = new Map<string, ProviderModels>()
  const ownedProviders = new Set<string>()
  let attachedConfig: HostConfig | undefined

  const project = (entry: ProviderEntry): void => {
    if (attachedConfig === undefined || options.npmSpecifiers === undefined) return
    const npm = options.npmSpecifiers[entry.id]
    if (npm === undefined) return
    const models = modelsByProvider.get(entry.id)
    if (models === undefined) {
      if (ownedProviders.delete(entry.id) && attachedConfig.provider !== undefined) {
        Reflect.deleteProperty(attachedConfig.provider, entry.id)
      }
      return
    }
    const provider = attachedConfig.provider ?? {}
    Object.defineProperty(provider, entry.id, {
      value: { npm, name: entry.displayName, models },
      enumerable: true,
      configurable: true,
      writable: true,
    })
    attachedConfig.provider = provider
    ownedProviders.add(entry.id)
  }

  return {
    publisher: {
      publish: async (snapshot, signal): Promise<void> => {
        if (signal.aborted) throw new OperationCancelledError("publish-v1-catalog")
        const entry = entries.get(snapshot.providerId)
        if (entry === undefined) throw new InvalidArgumentError("snapshot.providerId")
        switch (snapshot.status) {
          case "unavailable":
            modelsByProvider.delete(entry.id)
            break
          case "ready":
          case "stale": {
            const models = modelRecord(snapshot, entry)
            if (Reflect.ownKeys(models).length === 0) modelsByProvider.delete(entry.id)
            else modelsByProvider.set(entry.id, models)
            break
          }
          default:
            assertNever(snapshot)
        }
        project(entry)
      },
    },
    attach: (config): void => {
      attachedConfig = config
      for (const entry of options.entries) project(entry)
    },
  }
}
