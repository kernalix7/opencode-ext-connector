import { expect, it } from "bun:test"

import type { ProviderEntryDeps } from "../../../src/opencode/provider-entry"
import {
  createProviderRegistry,
  readProviderApiKey,
  selectActiveProviders,
  selectConfiguredProviders,
} from "../../../src/opencode/providers"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

function deps(key: string | null, env: Record<string, string> = {}): ProviderEntryDeps {
  return {
    env,
    transport: new FakeHttpTransport(),
    clock: new FakeClock(),
    authStore: {
      matchAuth: async (provider) =>
        provider === "claude" && key !== null ? { kind: "api-key", key } : null,
    },
    allowEnvironmentKeys: true,
  }
}

it("registers only dedicated Claude, Command Code and Ollama integrations", () => {
  // Given / When
  const entries = createProviderRegistry()
  // Then
  expect(entries.map((entry) => [entry.id, entry.integrationId])).toEqual([
    ["claude", "claude"],
    ["command-code", "command-code"],
    ["ollama", "ollama"],
  ])
})

it("selects configured and host-active providers without instantiating an adapter", async () => {
  // Given
  const entries = createProviderRegistry()
  // When
  const configured = selectConfiguredProviders(entries, ["claude"])
  const active = await selectActiveProviders(configured, async (id) => id === "claude")
  // Then
  expect(active.map((entry) => entry.id)).toEqual(["claude"])
})

it("prefers the dedicated API record over an explicit V1 environment key", async () => {
  // Given
  const state = deps("dedicated-key", { ANTHROPIC_API_KEY: "environment-key" })
  // When
  const key = await readProviderApiKey(state, "claude", new AbortController().signal)
  // Then
  expect(key).toBe("dedicated-key")
})

it("accepts explicit V1 env only, never the unrelated native record", async () => {
  // Given
  const state = deps(null, { ANTHROPIC_API_KEY: "environment-key" })
  // When
  const key = await readProviderApiKey(state, "claude", new AbortController().signal)
  // Then
  expect(key).toBe("environment-key")
})

it("does not fall back to process env for an unresolved V2 selection", async () => {
  // Given
  const state = {
    ...deps(null, { ANTHROPIC_API_KEY: "unrelated-key" }),
    allowEnvironmentKeys: false,
  }
  // When
  const key = await readProviderApiKey(state, "claude", new AbortController().signal)
  // Then
  expect(key).toBeNull()
})
