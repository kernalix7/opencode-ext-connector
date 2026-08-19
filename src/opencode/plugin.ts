import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { CatalogPublisher, ProviderAdapter } from "../core/adapter"
import type { Clock } from "../core/clock"
import type { HealthPolicy } from "../core/health"
import type { ConnectorLogger } from "../core/logger"
import type { CatalogDraft, Registration } from "./beta-api"
import { type HealthStore, refreshAdaptersWithHealth } from "./health-refresh"

export const PLUGIN_ID: string = "opencode-ext-connector"

export type CatalogHost = {
  readonly transform: (
    callback: (draft: CatalogDraft) => Promise<void> | void,
  ) => Promise<Registration>
}

export type LanguageHost = {
  readonly language: (
    callback: (input: {
      readonly model: { readonly providerID: string; readonly id: string }
      language?: LanguageModelV3
    }) => void,
  ) => Promise<Registration>
}

export type ConnectorSetupOptions = {
  readonly catalog: CatalogHost
  readonly adapters: readonly ProviderAdapter[]
  readonly logger: ConnectorLogger
  readonly createPublisher: (draft: CatalogDraft) => CatalogPublisher
  readonly clock?: Clock
  readonly health?: HealthPolicy
  readonly healthStore?: HealthStore
  readonly aisdk?: LanguageHost
  readonly createLanguage?: (providerID: string, modelId: string) => LanguageModelV3 | null
  readonly snapshotTimeoutMs?: number
}

export async function setupConnector(options: ConnectorSetupOptions): Promise<Registration> {
  const catalogRegistration = await options.catalog.transform(async (draft) => {
    const publisher = options.createPublisher(draft)
    await refreshAdaptersWithHealth({
      adapters: options.adapters,
      publisher,
      logger: options.logger,
      clock: options.clock ?? {
        nowMs: (): number => 0,
        schedule: () => ({
          cancel: (): void => undefined,
          [Symbol.dispose]: (): void => undefined,
        }),
      },
      health: options.health ?? { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
      store: options.healthStore ?? new Map(),
      signal: new AbortController().signal,
      snapshotTimeoutMs: options.snapshotTimeoutMs ?? 30_000,
    })
  })
  if (options.aisdk !== undefined && options.createLanguage !== undefined) {
    const createLanguage = options.createLanguage
    await options.aisdk.language((input) => {
      const language = createLanguage(input.model.providerID, input.model.id)
      if (language !== null) {
        input.language = language
      }
    })
  }
  return catalogRegistration
}
