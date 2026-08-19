import { describe, expect, it } from "bun:test"

import type { ProviderAdapter } from "../../../src/core/adapter"
import { DeadlineExceededError } from "../../../src/core/errors"
import { parseModelId, parseProviderId } from "../../../src/core/ids"
import { createConnectorLogger } from "../../../src/core/logger"
import type { ProviderSnapshot } from "../../../src/core/models"
import { createCatalogPublisher } from "../../../src/opencode/catalog-bridge"
import type { HealthStore } from "../../../src/opencode/health-refresh"
import { refreshAdaptersWithHealth } from "../../../src/opencode/health-refresh"
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

function hangingAdapter(providerId: string, started?: { value: boolean }): ProviderAdapter {
  return {
    providerId: parseProviderId(providerId),
    snapshot: async (signal: AbortSignal): Promise<ProviderSnapshot> => {
      if (started !== undefined) {
        started.value = true
      }
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
      throw new Error("unreachable")
    },
    dispose: async (): Promise<void> => undefined,
    [Symbol.asyncDispose]: async (): Promise<void> => undefined,
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  while (!predicate()) {
    await Promise.resolve()
  }
}

describe("refreshAdaptersWithHealth", () => {
  it("publishes ready adapters into the catalog and marks health ready", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    const clock = new FakeClock(1_000)
    const store: HealthStore = new Map()
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

    // When
    await refreshAdaptersWithHealth({
      adapters: [claude, cursor],
      publisher: createCatalogPublisher(draft),
      logger: createConnectorLogger(clock, sink),
      clock,
      health: { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
      store,
      signal: new AbortController().signal,
      snapshotTimeoutMs: 30_000,
    })

    // Then
    expect(draft.provider.get("claude")?.models.has("opus")).toBe(true)
    expect(draft.provider.get("cursor")?.models.has("composer")).toBe(true)
    const claudeHealth = store.get(parseProviderId("claude"))
    const cursorHealth = store.get(parseProviderId("cursor"))
    expect(claudeHealth?.status).toBe("ready")
    expect(cursorHealth?.status).toBe("ready")
    expect(claudeHealth?.consecutiveFailures).toBe(0)
    expect(cursorHealth?.consecutiveFailures).toBe(0)
  })

  it("times out a hanging snapshot and marks health unavailable", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    const clock = new FakeClock(1_000)
    const store: HealthStore = new Map()
    const claude = adapterFor({
      status: "ready",
      providerId: parseProviderId("claude"),
      models: [{ id: parseModelId("opus") }],
    })
    const started = { value: false }
    const cursor = hangingAdapter("cursor", started)

    // When
    const promise = refreshAdaptersWithHealth({
      adapters: [claude, cursor],
      publisher: createCatalogPublisher(draft),
      logger: createConnectorLogger(clock, sink),
      clock,
      health: { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
      store,
      signal: new AbortController().signal,
      snapshotTimeoutMs: 10,
    })
    await waitUntil(() => started.value)
    clock.advanceBy(10)
    await promise

    // Then
    expect(draft.provider.get("claude")?.models.has("opus")).toBe(true)
    expect(draft.provider.get("cursor")).toBeUndefined()
    const cursorHealth = store.get(parseProviderId("cursor"))
    expect(cursorHealth?.status).toBe("unavailable")
    expect(cursorHealth?.consecutiveFailures).toBe(1)
    expect(sink.records.some((r) => r.event === "provider.snapshot.failed")).toBe(true)
    const failedRecord = sink.records.find(
      (r) => r.event === "provider.snapshot.failed" && r.fields["providerId"] === "cursor",
    )
    expect(failedRecord?.fields["retryable"]).toBe(true)
    expect(failedRecord?.fields["message"]).toBe("connector deadline exceeded")
  })

  it("defers a provider when retryAtMs is in the future", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    const clock = new FakeClock(10_000)
    const store: HealthStore = new Map()
    store.set(parseProviderId("cursor"), {
      status: "unavailable",
      consecutiveFailures: 1,
      retryAtMs: 15_000,
    })
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

    // When
    await refreshAdaptersWithHealth({
      adapters: [claude, cursor],
      publisher: createCatalogPublisher(draft),
      logger: createConnectorLogger(clock, sink),
      clock,
      health: { initialBackoffMs: 5_000, maximumBackoffMs: 60_000 },
      store,
      signal: new AbortController().signal,
      snapshotTimeoutMs: 30_000,
    })

    // Then
    expect(cursorSnapshots).toBe(0)
    expect(draft.provider.get("claude")?.models.has("opus")).toBe(true)
    expect(sink.records.some((r) => r.event === "provider.snapshot.deferred")).toBe(true)
  })

  it("disposes deadline after each adapter even on timeout", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    const clock = new FakeClock(1_000)
    const store: HealthStore = new Map()
    const claude = adapterFor({
      status: "ready",
      providerId: parseProviderId("claude"),
      models: [{ id: parseModelId("opus") }],
    })
    const started = { value: false }
    const cursor = hangingAdapter("cursor", started)

    // When
    const promise = refreshAdaptersWithHealth({
      adapters: [claude, cursor],
      publisher: createCatalogPublisher(draft),
      logger: createConnectorLogger(clock, sink),
      clock,
      health: { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
      store,
      signal: new AbortController().signal,
      snapshotTimeoutMs: 10,
    })
    await waitUntil(() => started.value)
    clock.advanceBy(10)
    await promise

    // Then - deadline should be disposed (no leaked scheduled callbacks)
    expect(clock.pendingCount()).toBe(0)
  })

  it("aborts hanging snapshot signal when deadline expires", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const sink = new MemoryLogSink()
    const clock = new FakeClock(1_000)
    const store: HealthStore = new Map()
    let abortReason: unknown = null
    const started = { value: false }
    const cursor: ProviderAdapter = {
      providerId: parseProviderId("cursor"),
      snapshot: async (signal: AbortSignal): Promise<ProviderSnapshot> => {
        started.value = true
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              abortReason = signal.reason
              reject(signal.reason)
            },
            { once: true },
          )
        })
        throw new Error("unreachable")
      },
      dispose: async (): Promise<void> => undefined,
      [Symbol.asyncDispose]: async (): Promise<void> => undefined,
    }
    const claude = adapterFor({
      status: "ready",
      providerId: parseProviderId("claude"),
      models: [{ id: parseModelId("opus") }],
    })

    // When
    const promise = refreshAdaptersWithHealth({
      adapters: [claude, cursor],
      publisher: createCatalogPublisher(draft),
      logger: createConnectorLogger(clock, sink),
      clock,
      health: { initialBackoffMs: 1_000, maximumBackoffMs: 60_000 },
      store,
      signal: new AbortController().signal,
      snapshotTimeoutMs: 10,
    })
    await waitUntil(() => started.value)
    clock.advanceBy(10)
    await promise

    // Then
    expect(abortReason).toBeInstanceOf(DeadlineExceededError)
    if (abortReason instanceof DeadlineExceededError) {
      expect(abortReason.timeoutMs).toBe(10)
    }
  })
})
