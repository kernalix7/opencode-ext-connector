import { describe, expect, it } from "bun:test"

import type { ProviderAdapter } from "../../../src/core/adapter"
import { parseModelId, parseProviderId } from "../../../src/core/ids"
import { createConnectorLogger } from "../../../src/core/logger"
import type { ProviderSnapshot } from "../../../src/core/models"
import { createCatalogPublisher } from "../../../src/opencode/catalog-bridge"
import type { HealthStore } from "../../../src/opencode/health-refresh"
import { PLUGIN_ID, setupConnector } from "../../../src/opencode/plugin"
import { MemoryCatalogDraft } from "../../support/catalog"
import { FakeClock } from "../../support/clock"
import { MemoryLogSink } from "../../support/log-sink"

function adapterFor(snapshot: ProviderSnapshot): ProviderAdapter {
  return {
    providerId: snapshot.providerId,
    snapshot: async (_signal): Promise<ProviderSnapshot> => snapshot,
    dispose: async (): Promise<void> => undefined,
    [Symbol.asyncDispose]: async (): Promise<void> => undefined,
  }
}

function throwingAdapter(providerId: string): ProviderAdapter {
  return {
    providerId: parseProviderId(providerId),
    snapshot: async (): Promise<ProviderSnapshot> => {
      throw new Error("cursor down")
    },
    dispose: async (): Promise<void> => undefined,
    [Symbol.asyncDispose]: async (): Promise<void> => undefined,
  }
}

describe("setupConnector", () => {
  it("publishes ready adapters into the catalog", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    const claude = adapterFor({
      status: "ready",
      providerId: parseProviderId("claude"),
      models: [{ id: parseModelId("opus") }],
    })
    const cursor = adapterFor({
      status: "ready",
      providerId: parseProviderId("cursor"),
      models: [{ id: parseModelId("composer") }],
    })
    const commandCode = adapterFor({
      status: "ready",
      providerId: parseProviderId("command-code"),
      models: [{ id: parseModelId("alpha") }],
    })
    // When
    await setupConnector({
      catalog: {
        transform: async (callback) => {
          await callback(draft)
          return { dispose: async (): Promise<void> => undefined }
        },
      },
      adapters: [claude, cursor, commandCode],
      logger: createConnectorLogger(new FakeClock(), sink),
      createPublisher: createCatalogPublisher,
    })
    // Then
    expect(PLUGIN_ID).toBe("opencode-ext-connector")
    expect(draft.provider.get("claude")?.models.has("opus")).toBe(true)
    expect(draft.provider.get("cursor")?.models.has("composer")).toBe(true)
    expect(draft.provider.get("command-code")?.models.has("alpha")).toBe(true)
  })

  it("keeps healthy adapters when one snapshot fails", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    const claude = adapterFor({
      status: "ready",
      providerId: parseProviderId("claude"),
      models: [{ id: parseModelId("opus") }],
    })
    // When
    await setupConnector({
      catalog: {
        transform: async (callback) => {
          await callback(draft)
          return { dispose: async (): Promise<void> => undefined }
        },
      },
      adapters: [claude, throwingAdapter("cursor")],
      logger: createConnectorLogger(new FakeClock(), sink),
      createPublisher: createCatalogPublisher,
    })
    // Then
    expect(draft.provider.get("claude")?.models.has("opus")).toBe(true)
    expect(draft.provider.get("cursor")).toBeUndefined()
    expect(sink.records.some((record) => record.event === "provider.snapshot.failed")).toBe(true)
  })

  it("assigns a language model for claude via aisdk.language", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    let assignedProvider: string | undefined
    // When
    await setupConnector({
      catalog: {
        transform: async (callback) => {
          await callback(draft)
          return { dispose: async (): Promise<void> => undefined }
        },
      },
      adapters: [],
      logger: createConnectorLogger(new FakeClock(), sink),
      createPublisher: createCatalogPublisher,
      aisdk: {
        language: async (callback) => {
          const input: {
            readonly model: { readonly providerID: string; readonly id: string }
            language?: import("@ai-sdk/provider").LanguageModelV3
          } = { model: { providerID: "claude", id: "claude-sonnet-4-6" } }
          callback(input)
          assignedProvider = input.language?.provider
          return { dispose: async (): Promise<void> => undefined }
        },
      },
      createLanguage: (providerID, modelId) => ({
        specificationVersion: "v3",
        provider: providerID,
        modelId,
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error("unused")
        },
        doStream: async () => {
          throw new Error("unused")
        },
      }),
    })
    // Then
    expect(assignedProvider).toBe("claude")
  })

  it("defers a failed provider until backoff elapses without blocking others", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    const clock = new FakeClock(10_000)
    const store: HealthStore = new Map()
    let cursorSnapshots = 0
    const cursor: ProviderAdapter = {
      providerId: parseProviderId("cursor"),
      snapshot: async (): Promise<ProviderSnapshot> => {
        cursorSnapshots += 1
        throw new Error("cursor down")
      },
      dispose: async (): Promise<void> => undefined,
      [Symbol.asyncDispose]: async (): Promise<void> => undefined,
    }
    const claude = adapterFor({
      status: "ready",
      providerId: parseProviderId("claude"),
      models: [{ id: parseModelId("opus") }],
    })
    const options = {
      catalog: {
        transform: async (
          callback: (
            draft: import("../../../src/opencode/beta-api").CatalogDraft,
          ) => Promise<void> | void,
        ) => {
          await callback(draft)
          return { dispose: async (): Promise<void> => undefined }
        },
      },
      adapters: [claude, cursor],
      logger: createConnectorLogger(clock, sink),
      createPublisher: createCatalogPublisher,
      clock,
      health: { initialBackoffMs: 5_000, maximumBackoffMs: 60_000 },
      healthStore: store,
    }
    // When
    await setupConnector(options)
    await setupConnector(options)
    // Then
    expect(cursorSnapshots).toBe(1)
    expect(draft.provider.get("claude")?.models.has("opus")).toBe(true)
    expect(sink.records.some((record) => record.event === "provider.snapshot.deferred")).toBe(true)
  })
})
