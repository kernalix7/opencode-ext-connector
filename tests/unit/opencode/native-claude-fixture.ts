import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthHook } from "@opencode-ai/plugin"
import { z } from "zod"

import { createOpenCodeAuthStore } from "../../../src/opencode/auth-store"
import type { ProviderEntryDeps } from "../../../src/opencode/provider-entry"
import { createScopedClaudeLoader } from "../../../src/opencode/v1-claude-loader"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

type Loader = NonNullable<AuthHook["loader"]>
type SelectedAuth = Awaited<ReturnType<Parameters<Loader>[0]>>
export const nativeProvider: Parameters<Loader>[1] = {
  id: "anthropic",
  name: "Claude",
  source: "custom",
  env: [],
  options: {},
  models: {
    "fixture-model": {
      id: "fixture-model",
      providerID: "anthropic",
      name: "Fixture",
      api: { id: "fixture-model", url: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic" },
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 1000, output: 100 },
      status: "active",
      options: {},
      headers: {},
    },
  },
}
const fetchSchema = z.custom<typeof globalThis.fetch>((value) => typeof value === "function")

export async function nativeFixture() {
  const home = await mkdtemp(join(tmpdir(), "native-claude-"))
  const clock = new FakeClock()
  const transport = new FakeHttpTransport()
  const env = {
    HOME: home,
    XDG_DATA_HOME: home,
    CLAUDE_CONFIG_DIR: home,
    ANTHROPIC_CLI_VERSION: "9.9.9",
    PATH: "",
  }
  const credentialsPath = join(home, ".credentials.json")
  const authPath = join(home, "opencode", "auth.json")
  await mkdir(join(home, "opencode"))
  const credentials = async (token = "synthetic-native", expiresAt = 1_900_000_000_000) =>
    writeFile(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: token,
          refreshToken: "synthetic-refresh",
          expiresAt,
        },
      }),
    )
  const gate = async (auth: SelectedAuth = { type: "api", key: "cli-session:anthropic" }) =>
    writeFile(authPath, JSON.stringify({ anthropic: auth }))
  await credentials()
  await gate()
  let selected: SelectedAuth = { type: "api", key: "cli-session:anthropic" }
  const deps: ProviderEntryDeps = {
    env,
    clock,
    transport,
    authStore: createOpenCodeAuthStore({ env }),
    claudeAuthLookup: { readKeychain: async () => null },
    credentialRefresh: { mode: "auto", leadMs: 0 },
  }
  const scoped = createScopedClaudeLoader(deps)
  const provider = { ...nativeProvider, models: { ...nativeProvider.models } }
  return {
    deps,
    scoped,
    provider,
    transport,
    clock,
    home,
    credentialsPath,
    credentials,
    gate,
    select: (auth: SelectedAuth) => {
      selected = auth
    },
    load: () => scoped.loader(async () => selected, provider),
    fetch: async () =>
      fetchSchema.parse((await scoped.loader(async () => selected, provider))["fetch"]),
    dispose: async () => {
      try {
        await scoped.dispose()
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    },
  }
}

export const nativeRequest = {
  method: "POST",
  body: JSON.stringify({
    model: "fixture-model",
    messages: [{ role: "user", content: "fixture" }],
    max_tokens: 10,
  }),
}
export const nativeUrl = "https://api.anthropic.com/v1/messages"
