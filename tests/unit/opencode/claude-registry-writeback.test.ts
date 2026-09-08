import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Provider } from "@opencode-ai/sdk"
import type { ConnectorOptionsInput } from "../../../src/core/options"
import { createProviderRegistry } from "../../../src/opencode/providers"
import { buildV1AuthHooks } from "../../../src/opencode/v1-module"
import type { ClaudeCredentials } from "../../../src/providers/claude/credentials"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

const anthropicProvider: Provider = {
  id: "anthropic",
  name: "Anthropic",
  source: "custom",
  env: [],
  options: {},
  models: {},
}

type RefreshResult = {
  readonly oauthRequestUrls: readonly string[]
  readonly writtenCredentials: readonly ClaudeCredentials[]
}

type CredentialManagementOptions = ConnectorOptionsInput & {
  readonly credentialManagement: "connector" | "external"
}

const connectorManagementOptions: CredentialManagementOptions = {
  credentialManagement: "connector",
}
const externalManagementOptions: CredentialManagementOptions = {
  credentialManagement: "external",
}

async function refreshWithWriteback(
  connectorOptions: ConnectorOptionsInput,
): Promise<RefreshResult> {
  const root = await mkdtemp(join(tmpdir(), "claude-registry-writeback-"))
  const configDir = join(root, "claude")
  await mkdir(configDir, { recursive: true })
  await writeFile(
    join(configDir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "stored-access",
        refreshToken: "stored-refresh",
        expiresAt: 0,
      },
    }),
    "utf8",
  )
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode(
      JSON.stringify({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        expires_in: 3_600,
      }),
    ),
  })
  const written: ClaudeCredentials[] = []
  try {
    const entry = createProviderRegistry({
      writeClaudeCredentials: async (_env, credentials) => {
        written.push(credentials)
      },
    }).find((candidate) => candidate.id === "claude")
    if (entry === undefined) {
      throw new Error("expected Claude provider entry")
    }
    const hooks = buildV1AuthHooks(
      entry,
      {
        env: { CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_CLI_VERSION: "2.1.217" },
        transport,
        clock: new FakeClock(120_000),
        authStore: { matchAuth: async () => ({ kind: "oauth" }) },
        writeBackCredentials: false,
      },
      { providers: ["claude"], ...connectorOptions },
    )
    const loader = hooks.auth?.loader
    if (loader === undefined) {
      throw new Error("expected Anthropic auth loader")
    }
    const loaded = await loader(
      async () => ({
        type: "oauth",
        access: "host-access",
        refresh: "host-refresh",
        expires: 4_102_444_800_000,
      }),
      anthropicProvider,
    )
    const compatibilityFetch = Reflect.get(loaded, "fetch")
    if (typeof compatibilityFetch !== "function") {
      throw new Error("expected Claude compatibility fetch")
    }
    await compatibilityFetch("data:application/json,%7B%7D")
    return Object.freeze({
      oauthRequestUrls: Object.freeze(transport.requests.map((request) => request.url)),
      writtenCredentials: Object.freeze([...written]),
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

describe("Claude registry writeback", () => {
  it("refreshes and writes credentials for connector management", async () => {
    // Given / When
    const result = await refreshWithWriteback(connectorManagementOptions)

    // Then
    expect(result.oauthRequestUrls).toEqual(["https://claude.ai/v1/oauth/token"])
    expect(result.writtenCredentials).toHaveLength(1)
    expect(result.writtenCredentials[0]?.accessToken).toBe("rotated-access")
    expect(result.writtenCredentials[0]?.refreshToken).toBe("rotated-refresh")
  })

  it("does not refresh or write credentials for external management", async () => {
    // Given / When
    const result = await refreshWithWriteback(externalManagementOptions)

    // Then
    expect(result.oauthRequestUrls).toEqual([])
    expect(result.writtenCredentials).toHaveLength(0)
  })

  it("refreshes without writing when credential management is absent", async () => {
    // Given / When
    const result = await refreshWithWriteback({})

    // Then
    expect(result.oauthRequestUrls).toEqual(["https://claude.ai/v1/oauth/token"])
    expect(result.writtenCredentials).toHaveLength(0)
  })

  it("preserves legacy writeback behavior", async () => {
    // Given / When
    const result = await refreshWithWriteback({ writeBackCredentials: true })

    // Then
    expect(result.oauthRequestUrls).toEqual(["https://claude.ai/v1/oauth/token"])
    expect(result.writtenCredentials).toHaveLength(1)
    expect(result.writtenCredentials[0]?.accessToken).toBe("rotated-access")
    expect(result.writtenCredentials[0]?.refreshToken).toBe("rotated-refresh")
  })
})
