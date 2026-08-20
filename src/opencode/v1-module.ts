import type { AuthHook, Hooks, Plugin as V1Plugin } from "@opencode-ai/plugin"

import type { ProviderAdapter } from "../core/adapter"
import type { Clock } from "../core/clock"
import { createDeadline } from "../core/deadline"
import type { ProviderSnapshot } from "../core/models"

export type V1ServerOptions = {
  readonly clock: Clock
  readonly adapters: readonly ProviderAdapter[]
  readonly snapshotTimeoutMs?: number
  readonly anthropicAuth?: AuthHook
  readonly npmSpecifiers?: Readonly<Record<string, string>>
  readonly fallbackModelIds?: Readonly<Record<string, readonly string[]>>
  readonly isProviderConnected?: (providerId: string) => Promise<boolean>
}

const DISPLAY_NAME: { readonly [providerId: string]: string } = {
  claude: "Claude",
  cursor: "Cursor",
  "command-code": "Command Code",
}

type ProviderModels = {
  readonly [modelId: string]: {
    readonly id: string
    readonly name: string
  }
}

function modelsFromSnapshot(snapshot: ProviderSnapshot): ProviderModels | undefined {
  switch (snapshot.status) {
    case "unavailable":
      return undefined
    case "ready":
    case "stale": {
      const models: { [modelId: string]: { readonly id: string; readonly name: string } } = {}
      for (const model of snapshot.models) {
        models[model.id] = { id: model.id, name: model.id }
      }
      return models
    }
    default: {
      const _exhaustive: never = snapshot
      return _exhaustive
    }
  }
}

async function snapshotProviderModels(
  options: V1ServerOptions,
): Promise<ReadonlyMap<string, ProviderModels>> {
  const collected = new Map<string, ProviderModels>()
  for (const [providerId, modelIds] of Object.entries(options.fallbackModelIds ?? {})) {
    const models: { [modelId: string]: { readonly id: string; readonly name: string } } = {}
    for (const modelId of modelIds) {
      models[modelId] = { id: modelId, name: modelId }
    }
    collected.set(providerId, models)
  }
  for (const adapter of options.adapters) {
    const deadline = createDeadline({
      clock: options.clock,
      timeoutMs: options.snapshotTimeoutMs ?? 30_000,
      parentSignal: new AbortController().signal,
    })
    try {
      try {
        const snapshot = await adapter.snapshot(deadline.signal)
        const models = modelsFromSnapshot(snapshot)
        if (models !== undefined) {
          collected.set(adapter.providerId, models)
        }
      } catch {}
    } finally {
      await deadline.dispose()
    }
  }
  return collected
}

export async function buildV1Hooks(options: V1ServerOptions): Promise<Hooks> {
  const modelsByProvider = await snapshotProviderModels(options)
  const npmSpecifiers = options.npmSpecifiers
  const hooks: Hooks = {
    config: async (config) => {
      if (npmSpecifiers === undefined) {
        return
      }
      const provider = { ...config.provider }
      for (const [providerId, models] of modelsByProvider) {
        if (
          options.isProviderConnected !== undefined &&
          !(await options.isProviderConnected(providerId))
        ) {
          continue
        }
        const npmSpecifier = npmSpecifiers[providerId]
        if (npmSpecifier === undefined) {
          continue
        }
        provider[providerId] = {
          npm: npmSpecifier,
          name: DISPLAY_NAME[providerId] ?? providerId,
          models,
        }
      }
      config.provider = provider
    },
    dispose: async () => {
      for (const adapter of options.adapters) {
        await adapter.dispose()
      }
    },
  }
  if (options.anthropicAuth === undefined) {
    return hooks
  }
  return { ...hooks, auth: options.anthropicAuth }
}

export function createV1Server(options: V1ServerOptions): V1Plugin {
  return async (): Promise<Hooks> => buildV1Hooks(options)
}
