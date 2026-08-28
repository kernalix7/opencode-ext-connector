import { describe, expect, it } from "bun:test"

import { parseProviderId } from "../../../src/core/ids"
import type { IntegrationDraft } from "../../../src/opencode/beta-api"
import type { ProviderEntry } from "../../../src/opencode/provider-entry"
import { registerProviderIntegrations } from "../../../src/opencode/register-integrations"

function fakeAdapter(id: string) {
  return {
    providerId: parseProviderId(id),
    snapshot: async (): Promise<never> => {
      throw new Error("unused")
    },
    dispose: async (): Promise<void> => undefined,
    [Symbol.asyncDispose]: async (): Promise<void> => undefined,
  }
}

describe("registerProviderIntegrations", () => {
  it("registers an env integration method for each provider entry", () => {
    // Given
    const entries: ProviderEntry[] = [
      {
        id: "claude",
        displayName: "Claude",
        integrationId: "anthropic",
        integrationMethod: { type: "env", names: ["CLAUDE_ENABLED"] },
        createAdapter: () => fakeAdapter("claude"),
        createAuthHook: () => ({ provider: "anthropic", methods: [] }),
        isConnected: async () => false,
      },
      {
        id: "cursor",
        displayName: "Cursor",
        integrationId: "cursor",
        integrationMethod: { type: "env", names: ["CURSOR_ENABLED"] },
        createAdapter: () => fakeAdapter("cursor"),
        createAuthHook: () => ({ provider: "cursor", methods: [] }),
        isConnected: async () => false,
      },
    ]

    const registered: { integrationID: string; names: readonly string[] }[] = []
    const draft: IntegrationDraft = {
      list: () => [],
      get: () => undefined,
      update: () => undefined,
      remove: () => undefined,
      method: {
        list: () => [],
        update: (registration) => {
          if (registration.method.type === "env") {
            registered.push({
              integrationID: registration.integrationID,
              names: registration.method.names,
            })
          }
        },
        remove: () => undefined,
      },
    }

    // When
    registerProviderIntegrations(entries, draft)

    // Then
    expect(registered.map((r) => r.integrationID)).toEqual(["anthropic", "cursor"])
    expect(registered[0]?.names).toEqual(["CLAUDE_ENABLED"])
    expect(registered[1]?.names).toEqual(["CURSOR_ENABLED"])
  })
})
