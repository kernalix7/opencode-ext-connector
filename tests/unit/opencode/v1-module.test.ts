import { describe, expect, it } from "bun:test"

import type { Hooks } from "@opencode-ai/plugin"

import type { ProviderAdapter } from "../../../src/core/adapter"
import { parseModelId, parseProviderId } from "../../../src/core/ids"
import type { ProviderSnapshot } from "../../../src/core/models"
import { buildV1Hooks } from "../../../src/opencode/v1-module"
import { FakeClock } from "../../support/clock"

type HostConfig = Parameters<NonNullable<Hooks["config"]>>[0]

function adapterFor(snapshot: ProviderSnapshot): ProviderAdapter {
  return {
    providerId: snapshot.providerId,
    snapshot: async (_signal): Promise<ProviderSnapshot> => snapshot,
    dispose: async (): Promise<void> => undefined,
    [Symbol.asyncDispose]: async (): Promise<void> => undefined,
  }
}

describe("buildV1Hooks", () => {
  it("registers Claude Cursor and Command Code through this package", async () => {
    // Given
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      npmSpecifiers: {
        claude: "file:///claude",
        cursor: "file:///cursor",
        "command-code": "file:///command-code",
      },
      adapters: [
        adapterFor({
          status: "ready",
          providerId: parseProviderId("claude"),
          models: [{ id: parseModelId("opus") }],
        }),
        adapterFor({
          status: "ready",
          providerId: parseProviderId("cursor"),
          models: [{ id: parseModelId("composer") }],
        }),
        adapterFor({
          status: "ready",
          providerId: parseProviderId("command-code"),
          models: [{ id: parseModelId("Qwen/Qwen3.8-Max") }],
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

  it("omits unavailable adapters from config.provider", async () => {
    // Given
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      npmSpecifiers: {
        claude: "file:///claude",
        cursor: "file:///cursor",
      },
      adapters: [
        adapterFor({
          status: "unavailable",
          providerId: parseProviderId("cursor"),
          reason: "process-error",
        }),
        adapterFor({
          status: "ready",
          providerId: parseProviderId("claude"),
          models: [{ id: parseModelId("opus") }],
        }),
      ],
    })
    const config: HostConfig = {}
    // When
    await hooks.config?.(config)
    // Then
    expect(config.provider?.["claude"]?.npm).toBe("file:///claude")
    expect(config.provider?.["cursor"]).toBeUndefined()
  })

  it("attaches Claude Code as an Anthropic subscription method", async () => {
    // Given
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      adapters: [],
      anthropicAuth: {
        provider: "anthropic",
        methods: [
          {
            type: "oauth",
            label: "Claude Code subscription",
            authorize: async () => ({
              url: "",
              instructions: "ok",
              method: "auto",
              callback: async () => ({ type: "failed" }),
            }),
          },
        ],
      },
    })
    // Then
    expect(hooks.auth?.provider).toBe("anthropic")
    expect(hooks.auth?.methods[0]?.type).toBe("oauth")
  })
})
