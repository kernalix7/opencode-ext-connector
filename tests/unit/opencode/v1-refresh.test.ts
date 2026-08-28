import { describe, expect, it } from "bun:test"

import type { AuthHook, Hooks } from "@opencode-ai/plugin"

import type { ProviderAdapter } from "../../../src/core/adapter"
import { parseModelId, parseProviderId } from "../../../src/core/ids"
import type { ConnectorLogger } from "../../../src/core/logger"
import type { ProviderSnapshot } from "../../../src/core/models"
import type { OpenCodeAuthStore } from "../../../src/opencode/auth-store"
import type { ProviderEntry } from "../../../src/opencode/provider-entry"
import { buildV1Hooks } from "../../../src/opencode/v1-module"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

type HostConfig = Parameters<NonNullable<Hooks["config"]>>[0]
type SnapshotStep = ProviderSnapshot | Error | Promise<ProviderSnapshot>

const authStore: OpenCodeAuthStore = { matchAuth: async () => null }
const logger: ConnectorLogger = { log: () => undefined }
const cursorProvider = "cursor"
const unrelatedProvider = "unrelated"

function scriptedProvider(options: {
  readonly steps: SnapshotStep[]
  readonly onCreated?: () => void
  readonly onDisposed?: () => void
  readonly onSignal?: (signal: AbortSignal) => void
}): ProviderEntry {
  const adapter: ProviderAdapter = {
    providerId: parseProviderId("cursor"),
    snapshot: async (signal) => {
      options.onSignal?.(signal)
      const step = options.steps.shift()
      if (step === undefined) throw new Error("missing snapshot step")
      if (step instanceof Error) throw step
      return step
    },
    dispose: async () => options.onDisposed?.(),
    [Symbol.asyncDispose]: async () => options.onDisposed?.(),
  }
  const authHook: AuthHook = { provider: "cursor", methods: [] }
  return {
    id: "cursor",
    displayName: "Cursor",
    integrationId: "cursor",
    integrationMethod: { type: "env", names: ["CURSOR_ENABLED"] },
    createAdapter: () => {
      options.onCreated?.()
      return adapter
    },
    createAuthHook: () => authHook,
    isConnected: async () => true,
  }
}

function ready(modelId: string): ProviderSnapshot {
  return {
    status: "ready",
    providerId: parseProviderId("cursor"),
    models: [{ id: parseModelId(modelId) }],
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function runtimeOptions(clock: FakeClock, provider: ProviderEntry) {
  return {
    clock,
    transport: new FakeHttpTransport(),
    authStore,
    providers: [provider],
    npmSpecifiers: { cursor: "file:///cursor" },
    snapshotTimeoutMs: 50,
    catalogReloadMs: 10,
    health: { initialBackoffMs: 20, maximumBackoffMs: 40 },
    logger,
  }
}

describe("legacy V1 catalog refresh", () => {
  it("runs the initial snapshot with reload disabled and retains one adapter", async () => {
    // Given
    const clock = new FakeClock()
    let created = 0
    let disposed = 0
    const provider = scriptedProvider({
      steps: [ready("initial")],
      onCreated: () => {
        created += 1
      },
      onDisposed: () => {
        disposed += 1
      },
    })

    // When
    const hooks = await buildV1Hooks({ ...runtimeOptions(clock, provider), catalogReloadMs: 0 })
    const config: HostConfig = {}
    await hooks.config?.(config)
    clock.advanceBy(1_000)
    await hooks.dispose?.()
    await hooks.dispose?.()

    // Then
    const initialModel = "initial"
    expect(config.provider?.[cursorProvider]?.models?.[initialModel]?.id).toBe(initialModel)
    expect(created).toBe(1)
    expect(disposed).toBe(1)
    expect(clock.pendingCount()).toBe(0)
  })

  it("updates the attached config while preserving unrelated and prototype-sensitive entries", async () => {
    // Given
    const clock = new FakeClock()
    const provider = scriptedProvider({ steps: [ready("old"), ready("__proto__")] })
    const hooks = await buildV1Hooks(runtimeOptions(clock, provider))
    const config: HostConfig = { provider: { unrelated: { name: "Unrelated", models: {} } } }
    await hooks.config?.(config)

    // When
    clock.advanceBy(10)
    await flush()

    // Then
    const oldModel = "old"
    expect(config.provider?.[unrelatedProvider]?.name).toBe("Unrelated")
    expect(config.provider?.[cursorProvider]?.models?.[oldModel]).toBeUndefined()
    expect(Object.keys(config.provider?.[cursorProvider]?.models ?? {})).toContain("__proto__")
    await hooks.dispose?.()
  })

  it("preserves the last catalog on thrown failure and honors health backoff", async () => {
    // Given
    const clock = new FakeClock()
    const provider = scriptedProvider({
      steps: [ready("known"), new Error("temporary"), ready("recovered")],
    })
    const hooks = await buildV1Hooks(runtimeOptions(clock, provider))
    const config: HostConfig = {}
    await hooks.config?.(config)

    // When
    clock.advanceBy(10)
    await flush()
    clock.advanceBy(10)
    await flush()

    // Then
    const knownModel = "known"
    expect(config.provider?.[cursorProvider]?.models?.[knownModel]?.id).toBe(knownModel)
    clock.advanceBy(10)
    await flush()
    const recoveredModel = "recovered"
    expect(config.provider?.[cursorProvider]?.models?.[recoveredModel]?.id).toBe(recoveredModel)
    await hooks.dispose?.()
  })

  it("removes only connector-owned provider data on explicit unavailable", async () => {
    // Given
    const clock = new FakeClock()
    const provider = scriptedProvider({
      steps: [
        ready("known"),
        { status: "unavailable", providerId: parseProviderId("cursor"), reason: "process-error" },
      ],
    })
    const hooks = await buildV1Hooks(runtimeOptions(clock, provider))
    const config: HostConfig = { provider: { unrelated: { name: "Unrelated", models: {} } } }
    await hooks.config?.(config)

    // When
    clock.advanceBy(10)
    await flush()

    // Then
    expect(config.provider?.[cursorProvider]).toBeUndefined()
    expect(config.provider?.[unrelatedProvider]?.name).toBe("Unrelated")
    await hooks.dispose?.()
  })

  it("aborts and awaits an active reload before disposing the adapter once", async () => {
    // Given
    const clock = new FakeClock()
    const started = Promise.withResolvers<void>()
    let activeSignal: AbortSignal | undefined
    let disposed = 0
    const hanging = new Promise<ProviderSnapshot>((_resolve, reject) => {
      const waitForSignal = (): void => {
        if (activeSignal === undefined) return
        activeSignal.addEventListener("abort", () => reject(activeSignal?.reason), { once: true })
      }
      started.promise.then(waitForSignal)
    })
    const provider = scriptedProvider({
      steps: [ready("known"), hanging],
      onSignal: (signal) => {
        activeSignal = signal
        if (clock.nowMs() > 0) started.resolve()
      },
      onDisposed: () => {
        disposed += 1
      },
    })
    const hooks = await buildV1Hooks(runtimeOptions(clock, provider))
    clock.advanceBy(10)
    await started.promise

    // When
    await Promise.all([hooks.dispose?.(), hooks.dispose?.()])

    // Then
    expect(activeSignal?.aborted).toBe(true)
    expect(disposed).toBe(1)
    expect(clock.pendingCount()).toBe(0)
  })
})
