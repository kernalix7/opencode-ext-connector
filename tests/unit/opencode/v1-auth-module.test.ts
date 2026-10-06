import { describe, expect, it } from "bun:test"
import { ZodError } from "zod"

import type { ProviderEntry, ProviderEntryDeps } from "../../../src/opencode/provider-entry"
import { buildV1AuthHooks } from "../../../src/opencode/v1-module"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

function fakeEntry(id: string): ProviderEntry {
  return {
    id,
    displayName: id,
    integrationId: id,
    integrationMethod: { type: "env", names: [] },
    createAdapter: () => {
      throw new Error("Auth hook must not initialize a catalog")
    },
    createAuthHook: () => ({ provider: id, methods: [] }),
    isConnected: async () => false,
  }
}
const deps: ProviderEntryDeps = {
  env: {},
  transport: new FakeHttpTransport(),
  clock: new FakeClock(),
  authStore: { matchAuth: async () => null },
}

describe("official V1 auth hook selection", () => {
  it.each(["claude", "command-code", "ollama"])("returns only the selected %s hook", (id) => {
    // Given
    const entry = fakeEntry(id)
    // When
    const hooks = buildV1AuthHooks(entry, deps, { providers: [id] })
    // Then
    expect(Object.keys(hooks)).toEqual(["auth"])
    expect(hooks.auth?.provider).toBe(id)
  })

  it("does not return an unselected auth hook", () => {
    // Given
    const entry = fakeEntry("claude")
    // When
    const hooks = buildV1AuthHooks(entry, deps, { providers: ["ollama"] })
    // Then
    expect(hooks).toEqual({})
  })

  it.each([
    "credentialRole",
    "credentialManagement",
    "credentialAuthority",
    "credentialRefresh",
    "writeBackCredentials",
    "xaiOAuth",
  ])("rejects retired %s before invoking provider code", (field) => {
    // Given
    let calls = 0
    const entry: ProviderEntry = {
      ...fakeEntry("claude"),
      createAuthHook: () => {
        calls += 1
        return { provider: "claude", methods: [] }
      },
    }
    // When / Then
    expect(() => buildV1AuthHooks(entry, deps, { providers: ["claude"], [field]: false })).toThrow(
      ZodError,
    )
    expect(calls).toBe(0)
  })
})
