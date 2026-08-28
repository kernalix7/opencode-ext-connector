import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OpenCodeAuthMatch, OpenCodeAuthProvider } from "../../../src/opencode/auth-store"
import type { ProviderEntry, ProviderEntryDeps } from "../../../src/opencode/provider-entry"
import {
  createProviderRegistry,
  selectActiveProviders,
  selectConfiguredProviders,
} from "../../../src/opencode/providers"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

type ConnectionFixture = {
  readonly entryId: string
  readonly authProvider: OpenCodeAuthProvider
  readonly vendorAvailable: boolean
  readonly activeAuth: readonly OpenCodeAuthProvider[]
  readonly root: string
}

function commandDeps(
  match: OpenCodeAuthMatch,
  transport: FakeHttpTransport = new FakeHttpTransport(),
): ProviderEntryDeps {
  return {
    env: { HOME: "/isolated/home", PATH: "" },
    transport,
    clock: new FakeClock(),
    authStore: {
      matchAuth: async (provider) => (provider === "command-code" ? match : null),
    },
    writeBackCredentials: false,
  }
}

function authMatch(provider: OpenCodeAuthProvider): OpenCodeAuthMatch {
  return provider === "anthropic" ? { kind: "oauth" } : { kind: "marker" }
}

async function connectionState(fixture: ConnectionFixture): Promise<boolean> {
  const env: Record<string, string | undefined> = {
    HOME: join(fixture.root, "home"),
    CLAUDE_CONFIG_DIR: join(fixture.root, "claude"),
    PATH: "",
  }
  if (fixture.vendorAvailable) {
    env["CURSOR_ACCESS_TOKEN"] = "cursor-token"
    env["COMMAND_CODE_API_KEY"] = "command-code-token"
    await mkdir(env["CLAUDE_CONFIG_DIR"] ?? "", { recursive: true })
    await writeFile(
      join(env["CLAUDE_CONFIG_DIR"] ?? "", ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "claude-token",
          refreshToken: "claude-refresh",
          expiresAt: 4_102_444_800_000,
        },
      }),
      "utf8",
    )
  } else {
    await rm(env["CLAUDE_CONFIG_DIR"] ?? "", { force: true, recursive: true })
  }
  const active = new Set(fixture.activeAuth)
  const registry = createProviderRegistry()
  const entry = registry.find((candidate) => candidate.id === fixture.entryId)
  return entry === undefined
    ? false
    : entry.isConnected({
        env,
        transport: new FakeHttpTransport(),
        clock: new FakeClock(),
        authStore: {
          matchAuth: async (provider) => (active.has(provider) ? authMatch(provider) : null),
        },
        writeBackCredentials: false,
      })
}

describe("createProviderRegistry", () => {
  it("returns every supported provider entry", () => {
    // Given
    const registry = createProviderRegistry()

    // Then
    expect(registry.map((entry) => entry.id)).toEqual([
      "claude",
      "cursor",
      "command-code",
      "ollama",
    ])
    expect(registry.map((entry) => entry.displayName)).toEqual([
      "Claude",
      "Cursor",
      "Command Code",
      "Ollama",
    ])
  })

  it("exposes integration ids", () => {
    // Given
    const registry = createProviderRegistry()

    // Then
    expect(registry[0]?.integrationId).toBe("anthropic")
    expect(registry[1]?.integrationId).toBe("cursor")
    expect(registry[2]?.integrationId).toBe("command-code")
  })

  it("selects only providers with an active OpenCode connection", async () => {
    // Given
    const registry = createProviderRegistry()
    const active = new Set(["cursor"])

    // When
    const selected = await selectActiveProviders(registry, async (integrationId) =>
      active.has(integrationId),
    )

    // Then
    expect(selected.map((entry) => entry.id)).toEqual(["cursor"])
  })

  it("does not create adapters while checking active providers", async () => {
    // Given
    let adapterCreations = 0
    const entry: ProviderEntry = {
      id: "cursor",
      displayName: "Cursor",
      integrationId: "cursor",
      integrationMethod: { type: "env", names: ["CURSOR_EXT_CONNECTOR_ENABLED"] },
      createAdapter: () => {
        adapterCreations += 1
        throw new Error("adapter must not be created")
      },
      createAuthHook: () => ({ provider: "cursor", methods: [] }),
      isConnected: async () => false,
    }

    // When
    const selected = await selectActiveProviders([entry], async () => false)

    // Then
    expect(selected).toEqual([])
    expect(adapterCreations).toBe(0)
  })

  it("selects only explicitly configured provider ids", () => {
    // Given
    const registry = createProviderRegistry()

    // When
    const selected = selectConfiguredProviders(registry, ["cursor"])

    // Then
    expect(selected.map((entry) => entry.id)).toEqual(["cursor"])
  })

  it.each([
    { entryId: "claude", authProvider: "anthropic" },
    { entryId: "cursor", authProvider: "cursor" },
    { entryId: "command-code", authProvider: "command-code" },
  ])(
    "requires auth-store and vendor credentials for $entryId",
    async ({ entryId, authProvider }) => {
      // Given
      const root = await mkdtemp(join(tmpdir(), "connector-provider-entry-"))
      const otherAuth: OpenCodeAuthProvider = authProvider === "cursor" ? "anthropic" : "cursor"
      try {
        // When
        const vendorOnly = await connectionState({
          entryId,
          authProvider,
          vendorAvailable: true,
          activeAuth: [],
          root,
        })
        const authOnly = await connectionState({
          entryId,
          authProvider,
          vendorAvailable: false,
          activeAuth: [authProvider],
          root,
        })
        const both = await connectionState({
          entryId,
          authProvider,
          vendorAvailable: true,
          activeAuth: [authProvider],
          root,
        })
        const anotherProvider = await connectionState({
          entryId,
          authProvider,
          vendorAvailable: true,
          activeAuth: [otherAuth],
          root,
        })

        // Then
        expect({ vendorOnly, authOnly, both, anotherProvider }).toEqual({
          vendorOnly: false,
          authOnly: false,
          both: true,
          anotherProvider: false,
        })
      } finally {
        await rm(root, { recursive: true })
      }
    },
  )

  it("connects Command Code with a direct auth-store API key and no CLI credential", async () => {
    // Given
    const entry = createProviderRegistry().find((candidate) => candidate.id === "command-code")
    const deps = commandDeps({ kind: "api-key", key: "direct-command-key" })

    // When
    const connected = await entry?.isConnected(deps)

    // Then
    expect(connected).toBe(true)
  })

  it("supplies a direct auth-store API key to Command Code catalog discovery", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('["fixture-model"]'),
    })
    const entry = createProviderRegistry().find((candidate) => candidate.id === "command-code")
    const deps = commandDeps({ kind: "api-key", key: "direct-command-key" }, transport)
    const adapter = entry?.createAdapter(deps)

    // When
    const snapshot = await adapter?.snapshot(new AbortController().signal)

    // Then
    expect(snapshot?.status).toBe("ready")
    expect(transport.requests[0]?.headers["authorization"]).toBe("Bearer direct-command-key")
  })

  it("keeps Command Code marker auth disconnected without a CLI credential", async () => {
    // Given
    const entry = createProviderRegistry().find((candidate) => candidate.id === "command-code")
    const deps = commandDeps({ kind: "marker" })

    // When
    const connected = await entry?.isConnected(deps)

    // Then
    expect(connected).toBe(false)
  })
})
