import { expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Hooks } from "@opencode-ai/plugin"

import { createOpenCodeAuthStore } from "../../../src/opencode/auth-store"
import { createProviderRegistry } from "../../../src/opencode/providers"
import { buildV1Hooks } from "../../../src/opencode/v1-module"
import { createClaude } from "../../../src/sdk/claude"
import { createCommandCode } from "../../../src/sdk/command-code"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

it("publishes and generates from an existing Claude subscription without an API key", async () => {
  // Given
  const home = await mkdtemp(join(tmpdir(), "v1-subscription-"))
  try {
    await mkdir(join(home, "opencode"))
    await writeFile(
      join(home, "opencode", "auth.json"),
      JSON.stringify({ anthropic: { type: "api", key: "cli-session:anthropic" } }),
    )
    await writeFile(
      join(home, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "synthetic-claude",
          refreshToken: "synthetic-refresh",
          expiresAt: 1_900_000_000_000,
        },
      }),
    )
    const env = {
      HOME: home,
      XDG_DATA_HOME: home,
      CLAUDE_CONFIG_DIR: home,
      ANTHROPIC_CLI_VERSION: "9.9.9",
      PATH: "",
    }
    const transport = new FakeHttpTransport()
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: encode({ data: [{ id: "fixture-claude" }] }),
    })
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      transport,
      env,
      catalogReloadMs: 0,
      authStore: createOpenCodeAuthStore({ env }),
      providers: createProviderRegistry().filter((entry) => entry.id === "claude"),
      npmSpecifiers: { claude: "file:///fixture/claude.js" },
      claudeAuthLookup: { readKeychain: async () => null },
    })
    try {
      const config: Parameters<NonNullable<Hooks["config"]>>[0] = {}
      await hooks.config?.(config)
      const options = config.provider?.["claude"]?.options
      expect(config.provider?.["claude"]?.models?.["fixture-claude"]).toBeDefined()
      expect(JSON.stringify(config)).not.toContain("synthetic-claude")
      transport.enqueueResponse({
        status: 200,
        headers: { "content-type": "application/json" },
        body: encode({
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          model: "fixture-claude",
          content: [{ type: "text", text: "subscription-output" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      })
      // When
      const result = await createClaude(options)
        .languageModel("fixture-claude")
        .doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }],
        })
      // Then
      expect(result.content).toContainEqual({ type: "text", text: "subscription-output" })
      expect(transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer synthetic-claude")
      expect(transport.requests.at(-1)?.headers["x-api-key"]).toBeUndefined()
    } finally {
      await hooks.dispose?.()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it("routes an existing Command Code session through its production V1 binding", async () => {
  // Given
  const home = await mkdtemp(join(tmpdir(), "v1-command-session-"))
  try {
    await mkdir(join(home, "opencode"))
    await mkdir(join(home, ".commandcode"))
    await writeFile(
      join(home, "opencode", "auth.json"),
      JSON.stringify({
        "command-code": { type: "api", key: "cli-session:command-code" },
      }),
    )
    await writeFile(
      join(home, ".commandcode", "auth.json"),
      JSON.stringify({ apiKey: "synthetic-session" }),
    )
    const env = { HOME: home, XDG_DATA_HOME: home, COMMAND_CODE_CLI_VERSION: "9.9.9", PATH: "" }
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"data":[{"id":"command-model"}]}'),
    })
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      transport,
      env,
      catalogReloadMs: 0,
      authStore: createOpenCodeAuthStore({ env }),
      providers: createProviderRegistry().filter((entry) => entry.id === "command-code"),
      npmSpecifiers: { "command-code": "file:///fixture/command-code.js" },
    })
    try {
      const config: Parameters<NonNullable<Hooks["config"]>>[0] = {}
      await hooks.config?.(config)
      transport.enqueueResponse({
        status: 200,
        headers: {},
        body: new TextEncoder().encode(
          '{"type":"text-delta","text":"existing-session"}\n{"type":"finish"}',
        ),
      })
      // When
      const result = await createCommandCode(config.provider?.["command-code"]?.options)
        .languageModel("command-model")
        .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }] })
      // Then
      expect(result.content).toEqual([{ type: "text", text: "existing-session" }])
      expect(new URL(transport.requests.at(-1)?.url ?? "https://invalid.test").pathname).toBe(
        "/alpha/generate",
      )
      expect(transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer synthetic-session")
    } finally {
      await hooks.dispose?.()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it("keeps a Claude owner binding on the manager's observed refresh lineage", async () => {
  // Given
  const home = await mkdtemp(join(tmpdir(), "v1-owned-refresh-"))
  try {
    await mkdir(join(home, "opencode"))
    await writeFile(
      join(home, "opencode", "auth.json"),
      JSON.stringify({
        anthropic: { type: "api", key: "cli-session:anthropic" },
      }),
    )
    await writeFile(
      join(home, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "first-token",
          refreshToken: "first-refresh",
          expiresAt: 100,
        },
      }),
    )
    const env = {
      HOME: home,
      XDG_DATA_HOME: home,
      CLAUDE_CONFIG_DIR: home,
      ANTHROPIC_CLI_VERSION: "9.9.9",
      PATH: "",
    }
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        '{"access_token":"managed-token","refresh_token":"managed-refresh","expires_at":1900000000000}',
      ),
    })
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"data":[{"id":"managed-model"}]}'),
    })
    const hooks = await buildV1Hooks({
      clock: new FakeClock(),
      transport,
      env,
      catalogReloadMs: 0,
      credentialRefresh: { mode: "auto", leadMs: 60_000 },
      authStore: createOpenCodeAuthStore({ env }),
      providers: createProviderRegistry().filter((entry) => entry.id === "claude"),
      npmSpecifiers: { claude: "file:///fixture/claude.js" },
      claudeAuthLookup: { readKeychain: async () => null },
    })
    try {
      const config: Parameters<NonNullable<Hooks["config"]>>[0] = {}
      await hooks.config?.(config)
      transport.enqueueResponse({
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(
          '{"id":"msg_managed","type":"message","role":"assistant","model":"managed-model","content":[{"type":"text","text":"retained"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}',
        ),
      })
      // When
      const result = await createClaude(config.provider?.["claude"]?.options)
        .languageModel("managed-model")
        .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }] })
      // Then
      expect(result.content).toContainEqual({ type: "text", text: "retained" })
      expect(
        transport.requests.map((request) => request.headers["authorization"]).filter(Boolean),
      ).toEqual(["Bearer managed-token", "Bearer managed-token"])
    } finally {
      await hooks.dispose?.()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
