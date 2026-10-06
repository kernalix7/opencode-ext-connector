import { randomUUID } from "node:crypto"

import type { CatalogPublisher } from "../core/adapter.js"
import { InvalidArgumentError, OperationCancelledError } from "../core/errors.js"
import type { OpenCodeAuthMatch } from "./auth-store.js"
import type { PluginV2ConnectionInfo, PluginV2ProviderEditor } from "./beta-api.js"
import { IntegrationV2, ModelV2, ProviderV2 } from "./beta-api.js"
import type { ProviderEntry } from "./provider-entry.js"

export const CONNECTOR_MODULE = "opencode-ext-connector"
export const CONNECTOR_PACKAGE: string = CONNECTOR_MODULE
export const CONNECTOR_AISDK_PACKAGE: string = `aisdk:${new URL("./v2-sdk.js", import.meta.url).href}`

type PublishedProvider = {
  readonly providerId: string
  readonly displayName: string
  readonly integrationId: string
  readonly modelIds: readonly string[]
  readonly settings?: ProviderV2.Info["settings"]
  readonly sourceConnection?: PluginV2ConnectionInfo
}

export type V2Catalog = {
  readonly publisher: CatalogPublisher
  readonly apply: (editor: PluginV2ProviderEditor) => void
  readonly forget: (providerId: string) => void
  readonly rememberConnection: (
    providerId: string,
    connection: PluginV2ConnectionInfo | undefined,
  ) => void
  readonly hasModel: (providerId: string, modelId: string) => boolean
  readonly signature: () => string
  readonly rotate: (providerId: string, match: OpenCodeAuthMatch) => void
  readonly matchesConnection: (providerId: string, match: OpenCodeAuthMatch | null) => boolean
  readonly generation: (providerId: string) => number
}

function sameMatch(left: OpenCodeAuthMatch | undefined, right: OpenCodeAuthMatch | null): boolean {
  if (left === undefined || right === null) return false
  if (left.kind !== right.kind) return false
  if (left.kind === "marker")
    return right.kind === "marker" && left.connectionId === right.connectionId
  return (
    right.kind === "api-key" && left.key === right.key && left.connectionId === right.connectionId
  )
}

function assertNever(value: never): never {
  throw new InvalidArgumentError("snapshot.status", value)
}

function settingsFrom(
  options: Readonly<Record<string, unknown>> | undefined,
): ProviderV2.Info["settings"] | undefined {
  if (options === undefined) return undefined
  const settings: { [key: string]: string } = {}
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "string") settings[key] = value
  }
  return Object.keys(settings).length === 0 ? undefined : settings
}

function connectionKey(connection: PluginV2ConnectionInfo | undefined): string {
  if (connection === undefined) return ""
  return connection.type === "credential" ? connection.id : connection.name
}

function providerInfo(record: PublishedProvider): ProviderV2.Info {
  return {
    ...ProviderV2.Info.empty(ProviderV2.ID.make(record.providerId)),
    name: record.displayName,
    integrationID: IntegrationV2.ID.make(record.integrationId),
    activation: "enabled",
    package: CONNECTOR_AISDK_PACKAGE,
    ...(record.settings === undefined ? {} : { settings: record.settings }),
  }
}

function modelInfo(providerId: string, modelId: string): ModelV2.Info {
  return {
    ...ModelV2.Info.default(ProviderV2.ID.make(providerId), ModelV2.ID.make(modelId)),
    name: modelId,
    package: CONNECTOR_AISDK_PACKAGE,
  }
}

export function createV2Catalog(entries: readonly ProviderEntry[]): V2Catalog {
  const opencodeConnectorInstance = randomUUID()
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const configured = new Set(entries.map((entry) => entry.id))
  const published = new Map<string, PublishedProvider>()
  const pendingConnections = new Map<string, PluginV2ConnectionInfo>()
  const matches = new Map<string, OpenCodeAuthMatch>()
  const generations = new Map<string, number>()
  const increment = (providerId: string): void => {
    generations.set(providerId, (generations.get(providerId) ?? 0) + 1)
  }
  return {
    publisher: {
      publish: async (snapshot, signal): Promise<void> => {
        if (signal.aborted) throw new OperationCancelledError("publish-v2-catalog")
        const entry = byId.get(snapshot.providerId)
        if (entry === undefined) throw new InvalidArgumentError("snapshot.providerId")
        switch (snapshot.status) {
          case "unavailable":
            published.delete(snapshot.providerId)
            return
          case "ready":
          case "stale": {
            const live = snapshot.models.map((model) => model.id)
            const modelIds = live.length === 0 ? [...(entry.fallbackModelIds ?? [])] : live
            if (modelIds.length === 0) {
              published.delete(snapshot.providerId)
              return
            }
            const settings = { ...settingsFrom(entry.providerOptions), opencodeConnectorInstance }
            const sourceConnection = pendingConnections.get(snapshot.providerId)
            published.set(snapshot.providerId, {
              providerId: snapshot.providerId,
              displayName: entry.displayName,
              integrationId: entry.integrationId,
              modelIds,
              settings,
              ...(sourceConnection === undefined ? {} : { sourceConnection }),
            })
            return
          }
          default:
            assertNever(snapshot)
        }
      },
    },
    apply: (editor): void => {
      for (const record of editor.list()) {
        if (record.provider.package !== CONNECTOR_AISDK_PACKAGE) continue
        if (!configured.has(record.provider.id) || !published.has(record.provider.id)) {
          editor.remove(record.provider.id)
        }
      }
      for (const record of published.values()) {
        if (editor.get(record.providerId) !== undefined) editor.remove(record.providerId)
        editor.add({
          info: providerInfo(record),
          models: record.modelIds.map((modelId) => modelInfo(record.providerId, modelId)),
          ...(record.sourceConnection === undefined
            ? {}
            : { sourceConnection: record.sourceConnection }),
        })
      }
    },
    forget: (providerId): void => {
      if (matches.delete(providerId)) increment(providerId)
      published.delete(providerId)
      pendingConnections.delete(providerId)
    },
    rotate: (providerId, match): void => {
      if (sameMatch(matches.get(providerId), match)) return
      increment(providerId)
      matches.set(providerId, match)
      published.delete(providerId)
      pendingConnections.delete(providerId)
    },
    matchesConnection: (providerId, match): boolean => sameMatch(matches.get(providerId), match),
    generation: (providerId): number => generations.get(providerId) ?? 0,
    rememberConnection: (providerId, connection): void => {
      if (connection?.type === "credential" && connection.status === undefined) {
        pendingConnections.set(providerId, connection)
        return
      }
      pendingConnections.delete(providerId)
    },
    hasModel: (providerId, modelId): boolean =>
      published.get(providerId)?.modelIds.includes(modelId) === true,
    signature: (): string =>
      [...published.values()]
        .sort((left, right) => (left.providerId < right.providerId ? -1 : 1))
        .map(
          (record) =>
            `${record.providerId}:${record.modelIds.join(",")}:${connectionKey(record.sourceConnection)}:${generations.get(record.providerId) ?? 0}`,
        )
        .join("|"),
  }
}
