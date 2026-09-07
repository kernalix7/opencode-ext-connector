import { describe, expect, it } from "bun:test"
import { ZodError } from "zod"

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
    ["unsupported string", "host"],
    ["null", null],
    ["number", 1],
    ["malformed mixture", ["connector", "external"]],
  ])(
    "rejects %s credential management before creating an auth hook",
    (_case, credentialManagement) => {
      // Given
      let createAuthHookCalls = 0
      const entry: ProviderEntry = {
        ...fakeEntry("claude", "anthropic"),
        createAuthHook: () => {
          createAuthHookCalls += 1
          return { provider: "anthropic", methods: [] }
        },
      }

      // When
      const build = (): unknown =>
        buildV1AuthHooks(entry, deps, { providers: ["claude"], credentialManagement })

      // Then
      expect(build).toThrow()
      expect(createAuthHookCalls).toBe(0)
    },
  )

  it.each([
    ["connector refresh null", "connector", "credentialRefresh", null, ["credentialRefresh"]],
    ["external refresh number", "external", "credentialRefresh", 1, ["credentialRefresh"]],
    [
      "connector malformed refresh object",
      "connector",
      "credentialRefresh",
      { mode: "sometimes" },
      ["credentialRefresh", "mode"],
    ],
    [
      "external writeback string",
      "external",
      "writeBackCredentials",
      "yes",
      ["writeBackCredentials"],
    ],
    [
      "connector writeback number",
      "connector",
      "writeBackCredentials",
      1,
      ["writeBackCredentials"],
    ],
  ] as const)(
    "rejects malformed policy input before creating an auth hook: %s",
    (_case, credentialManagement, field, malformed, expectedPath) => {
      // Given
      let createAuthHookCalls = 0
      let error: unknown
      const entry: ProviderEntry = {
        ...fakeEntry("claude", "anthropic"),
        createAuthHook: () => {
          createAuthHookCalls += 1
          return { provider: "anthropic", methods: [] }
        },
      }

      // When
      try {
        buildV1AuthHooks(entry, deps, {
          providers: ["claude"],
          credentialManagement,
          [field]: malformed,
        })
      } catch (cause) {
        error = cause
      }

      // Then
      expect(error).toBeInstanceOf(ZodError)
      if (!(error instanceof ZodError)) return
      expect(error.issues.some((issue) => issue.path.join(".") === expectedPath.join("."))).toBe(
        true,
      )
      expect(createAuthHookCalls).toBe(0)
    },
  )

  it.each([
    ["refresh null", { credentialRefresh: null }],
    ["refresh number", { credentialRefresh: 1 }],
    ["malformed refresh object", { credentialRefresh: { mode: "sometimes" } }],
    ["writeback string", { writeBackCredentials: "yes" }],
    ["writeback number", { writeBackCredentials: 1 }],
    ["explicit undefined", { credentialRefresh: undefined, writeBackCredentials: undefined }],
  ] as const)("creates an auth hook after legacy-alone sanitization: %s", (_case, policy) => {
    // Given
    let createAuthHookCalls = 0
    const entry: ProviderEntry = {
      ...fakeEntry("claude", "anthropic"),
      createAuthHook: () => {
        createAuthHookCalls += 1
        return { provider: "anthropic", methods: [] }
      },
    }

    // When
    buildV1AuthHooks(entry, deps, { providers: ["claude"], ...policy })

    // Then
    expect(createAuthHookCalls).toBe(1)
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

  it("threads the credential refresh policy through auth dependencies", () => {
    // Given
    let received: unknown
    const entry: ProviderEntry = {
      ...fakeEntry("claude", "anthropic"),
      createAuthHook: (providerDeps) => {
        received = providerDeps.credentialRefresh
        return { provider: "anthropic", methods: [] }
      },
    }

    // When
    buildV1AuthHooks(entry, deps, {
      providers: ["claude"],
      credentialRefresh: { mode: "never", leadMs: 1_800_000 },
    })

    // Then
    expect(received).toEqual({ mode: "never", leadMs: 1_800_000 })
  })

  const credentialPolicyCases: readonly (readonly [
    unknown,
    ProviderEntryDeps["credentialRefresh"],
    boolean,
  ])[] = [
    [{ providers: ["claude"] }, { mode: "auto", leadMs: 60_000 }, false],
    [
      { providers: ["claude"], credentialManagement: "connector" },
      { mode: "auto", leadMs: 60_000 },
      true,
    ],
    [
      { providers: ["claude"], credentialManagement: "external" },
      { mode: "never", leadMs: 60_000 },
      false,
    ],
  ]

  it.each(credentialPolicyCases)(
    "normalizes credential policy dependencies for %s",
    (options, expectedCredentialRefresh, expectedWriteBackCredentials) => {
      // Given
      let received:
        | {
            readonly credentialRefresh: ProviderEntryDeps["credentialRefresh"]
            readonly writeBackCredentials: boolean
          }
        | undefined
      const entry: ProviderEntry = {
        ...fakeEntry("claude", "anthropic"),
        createAuthHook: (providerDeps) => {
          received = {
            credentialRefresh: providerDeps.credentialRefresh,
            writeBackCredentials: providerDeps.writeBackCredentials,
          }
          return { provider: "anthropic", methods: [] }
        },
      }

      // When
      buildV1AuthHooks(entry, deps, options)

      // Then
      expect(received).toEqual({
        credentialRefresh: expectedCredentialRefresh,
        writeBackCredentials: expectedWriteBackCredentials,
      })
    },
  )
})
