import { describe, expect, it } from "bun:test"

import type { ProviderEntry, ProviderEntryDeps } from "../../../src/opencode/provider-entry"
import { buildV1AuthHooks } from "../../../src/opencode/v1-module"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

function fakeEntry(id: string, authProvider: string): ProviderEntry {
  return {
    id,
    displayName: id,
    integrationId: authProvider,
    integrationMethod: { type: "env", names: [] },
    createAdapter: () => {
      throw new Error("auth server must not create adapters")
    },
    createAuthHook: () => ({ provider: authProvider, methods: [] }),
    isConnected: async () => false,
  }
}

const deps: ProviderEntryDeps = {
  env: {},
  transport: new FakeHttpTransport(),
  clock: new FakeClock(),
  authStore: { matchAuth: async () => null },
  writeBackCredentials: false,
}

describe("buildV1AuthHooks", () => {
  it.each([
    ["claude", "anthropic"],
    ["cursor", "cursor"],
    ["command-code", "command-code"],
  ])("returns only the selected %s auth hook", (id, authProvider) => {
    // Given
    const entry = fakeEntry(id, authProvider)

    // When
    const hooks = buildV1AuthHooks(entry, deps, { providers: [id] })

    // Then
    expect(Object.keys(hooks)).toEqual(["auth"])
    expect(hooks.auth?.provider).toBe(authProvider)
  })

  it("returns no hooks when its provider is unselected", () => {
    // Given
    const entry = fakeEntry("claude", "anthropic")

    // When
    const hooks = buildV1AuthHooks(entry, deps, { providers: ["cursor"] })

    // Then
    expect(hooks).toEqual({})
  })

  it.each([
    [true, true],
    [false, false],
  ])("threads writeBackCredentials=%s through auth dependencies", (configured, expected) => {
    // Given
    let received: unknown
    const entry: ProviderEntry = {
      ...fakeEntry("claude", "anthropic"),
      createAuthHook: (providerDeps) => {
        received = providerDeps.writeBackCredentials
        return { provider: "anthropic", methods: [] }
      },
    }

    // When
    buildV1AuthHooks(entry, deps, {
      providers: ["claude"],
      writeBackCredentials: configured,
    })

    // Then
    expect(received).toBe(expected)
  })
})
