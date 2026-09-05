import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Provider } from "@opencode-ai/sdk"
import type { CredentialRefreshPolicy } from "../../../src/core/options"
import { createProviderRegistry } from "../../../src/opencode/providers"
import { buildV1AuthHooks } from "../../../src/opencode/v1-module"
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

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function expiredCredentialsDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "claude-refresh-policy-"))
  roots.push(root)
  const configDir = join(root, "claude")
  await mkdir(configDir, { recursive: true })
  await writeFile(
    join(configDir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: { accessToken: "host-access", refreshToken: "host-refresh", expiresAt: 0 },
    }),
    "utf8",
  )
  return configDir
}

async function fetchThroughAuthHook(
  transport: FakeHttpTransport,
  credentialRefresh: CredentialRefreshPolicy,
): Promise<void> {
  const entry = createProviderRegistry().find((candidate) => candidate.id === "claude")
  if (entry === undefined) {
    throw new Error("expected Claude provider entry")
  }
  const hooks = buildV1AuthHooks(
    entry,
    {
      env: { CLAUDE_CONFIG_DIR: await expiredCredentialsDir(), ANTHROPIC_CLI_VERSION: "2.1.217" },
      transport,
      clock: new FakeClock(120_000),
      authStore: { matchAuth: async () => ({ kind: "oauth" }) },
      writeBackCredentials: false,
    },
    { providers: ["claude"], credentialRefresh },
  )
  const loader = hooks.auth?.loader
  if (loader === undefined) {
    throw new Error("expected Anthropic auth loader")
  }
  const loaded = await loader(
    async () => ({ type: "oauth", access: "x", refresh: "y", expires: 0 }),
    anthropicProvider,
  )
  const compatibilityFetch = Reflect.get(loaded, "fetch")
  if (typeof compatibilityFetch !== "function") {
    throw new Error("expected Claude compatibility fetch")
  }
  await compatibilityFetch("data:application/json,%7B%7D")
}

describe("Claude credential refresh policy", () => {
  it("rotates expired credentials through OAuth in auto mode", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({ access_token: "rotated", refresh_token: "rotated-r", expires_in: 3_600 }),
      ),
    })

    // When
    await fetchThroughAuthHook(transport, { mode: "auto", leadMs: 60_000 })

    // Then
    expect(transport.requests.map((request) => request.url)).toEqual([
      "https://claude.ai/v1/oauth/token",
    ])
  })

  it("never contacts the OAuth endpoint in never mode", async () => {
    // Given
    const transport = new FakeHttpTransport()

    // When
    await fetchThroughAuthHook(transport, { mode: "never", leadMs: 60_000 })

    // Then
    expect(transport.requests).toEqual([])
  })
})
