import { describe, expect, it } from "bun:test"

import type { AuthHook, Hooks } from "@opencode-ai/plugin"

import type { ProviderAdapter } from "../../../src/core/adapter"
import { parseModelId, parseProviderId } from "../../../src/core/ids"
import type { ProviderSnapshot } from "../../../src/core/models"
import type { OpenCodeAuthStore } from "../../../src/opencode/auth-store"
import type { ProviderEntry } from "../../../src/opencode/provider-entry"
import { buildV1Hooks } from "../../../src/opencode/v1-module"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

type HostConfig = Parameters<NonNullable<Hooks["config"]>>[0]

const disconnectedAuthStore: OpenCodeAuthStore = {
  matchAuth: async () => null,
}

function fakeProvider(options: {
  id: string
  displayName: string
  snapshot: ProviderSnapshot
  connected: boolean
  onSnapshot?: () => void
  npmSpecifier?: string
  authProvider?: string
  fallbackModelIds?: readonly string[]
}): ProviderEntry {
  const adapter: ProviderAdapter = {
    providerId: parseProviderId(options.id),
    snapshot: async () => {
      options.onSnapshot?.()
      return options.snapshot
    },
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  }
  const authHook: AuthHook = {
    provider: options.authProvider ?? options.id,
    methods: [],
  }
  return {
    id: options.id,
    displayName: options.displayName,
    integrationId: options.id,
    integrationMethod: { type: "env", names: [`${options.id.toUpperCase()}_ENABLED`] },
    fallbackModelIds: options.fallbackModelIds ?? [],
    createAdapter: () => adapter,
    createAuthHook: () => authHook,
    isConnected: async () => options.connected,
  }
}

describe("buildV1Hooks", () => {
  it("registers connected providers through this package", async () => {
    // Given
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      transport: new FakeHttpTransport(),
      authStore: disconnectedAuthStore,
      npmSpecifiers: {
        claude: "file:///claude",
        cursor: "file:///cursor",
        "command-code": "file:///command-code",
      },
      providers: [
        fakeProvider({
          id: "claude",
          displayName: "Claude",
          connected: true,
          npmSpecifier: "file:///claude",
          snapshot: {
            status: "ready",
            providerId: parseProviderId("claude"),
            models: [{ id: parseModelId("opus") }],
          },
        }),
        fakeProvider({
          id: "cursor",
          displayName: "Cursor",
          connected: true,
          npmSpecifier: "file:///cursor",
          snapshot: {
            status: "ready",
            providerId: parseProviderId("cursor"),
            models: [{ id: parseModelId("composer") }],
          },
        }),
        fakeProvider({
          id: "command-code",
          displayName: "Command Code",
          connected: true,
          npmSpecifier: "file:///command-code",
          snapshot: {
            status: "ready",
            providerId: parseProviderId("command-code"),
            models: [{ id: parseModelId("Qwen/Qwen3.8-Max") }],
          },
        }),
      ],
    })
    const config: HostConfig = {}
    // When
    await hooks.config?.(config)
    // Then
    expect(config.provider?.["claude"]?.npm).toBe("file:///claude")
    expect(config.provider?.["claude"]?.options?.apiKey).toBeUndefined()
    expect(config.provider?.["cursor"]?.npm).toBe("file:///cursor")
    expect(config.provider?.["command-code"]?.npm).toBe("file:///command-code")
  })

  it("omits unconnected providers from config.provider", async () => {
    // Given
    let cursorSnapshots = 0
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      transport: new FakeHttpTransport(),
      authStore: disconnectedAuthStore,
      npmSpecifiers: {
        claude: "file:///claude",
        cursor: "file:///cursor",
      },
      providers: [
        fakeProvider({
          id: "claude",
          displayName: "Claude",
          connected: true,
          npmSpecifier: "file:///claude",
          snapshot: {
            status: "ready",
            providerId: parseProviderId("claude"),
            models: [{ id: parseModelId("opus") }],
          },
        }),
        fakeProvider({
          id: "cursor",
          displayName: "Cursor",
          connected: false,
          onSnapshot: () => {
            cursorSnapshots += 1
          },
          npmSpecifier: "file:///cursor",
          snapshot: {
            status: "unavailable",
            providerId: parseProviderId("cursor"),
            reason: "process-error",
          },
        }),
      ],
    })
    const config: HostConfig = {}
    // When
    await hooks.config?.(config)
    // Then
    expect(config.provider?.["claude"]?.npm).toBe("file:///claude")
    expect(config.provider?.["cursor"]).toBeUndefined()
    expect(cursorSnapshots).toBe(0)
  })

  it("does not publish fallback models when snapshot is unavailable", async () => {
    // Given
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      transport: new FakeHttpTransport(),
      authStore: disconnectedAuthStore,
      npmSpecifiers: {
        "command-code": "file:///command-code",
      },
      providers: [
        fakeProvider({
          id: "command-code",
          displayName: "Command Code",
          connected: true,
          fallbackModelIds: ["Qwen/Qwen3.8-Max"],
          npmSpecifier: "file:///command-code",
          snapshot: {
            status: "unavailable",
            providerId: parseProviderId("command-code"),
            reason: "invalid-data",
          },
        }),
      ],
    })
    const config: HostConfig = {}
    // When
    await hooks.config?.(config)
    // Then
    expect(config.provider?.["command-code"]).toBeUndefined()
  })

  it("uses fallback models when a connected snapshot has none", async () => {
    // Given
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      transport: new FakeHttpTransport(),
      authStore: disconnectedAuthStore,
      npmSpecifiers: {
        "command-code": "file:///command-code",
      },
      providers: [
        fakeProvider({
          id: "command-code",
          displayName: "Command Code",
          connected: true,
          fallbackModelIds: ["Qwen/Qwen3.8-Max"],
          npmSpecifier: "file:///command-code",
          snapshot: {
            status: "ready",
            providerId: parseProviderId("command-code"),
            models: [],
          },
        }),
      ],
    })
    const config: HostConfig = {}
    // When
    await hooks.config?.(config)
    // Then
    expect(config.provider?.["command-code"]?.models?.["Qwen/Qwen3.8-Max"]?.id).toBe(
      "Qwen/Qwen3.8-Max",
    )
  })

  it("does not attach a provider auth hook", async () => {
    // Given
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      transport: new FakeHttpTransport(),
      authStore: disconnectedAuthStore,
      providers: [
        fakeProvider({
          id: "claude",
          displayName: "Claude",
          connected: true,
          snapshot: {
            status: "ready",
            providerId: parseProviderId("claude"),
            models: [{ id: parseModelId("opus") }],
          },
        }),
      ],
    })
    // Then
    expect(hooks.auth).toBeUndefined()
  })
})
