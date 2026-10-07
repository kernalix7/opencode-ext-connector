import { expect, it } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Hooks } from "@opencode-ai/plugin"
import { parseModelId, parseProviderId } from "../../../src/core/ids"
import { createProviderRegistry } from "../../../src/opencode/providers"
import { createV1CatalogProjector } from "../../../src/opencode/v1-catalog"
import { buildV1Hooks } from "../../../src/opencode/v1-module"
import { createV1Owner } from "../../../src/opencode/v1-owner"
import { ClaudeCredentialLookupError } from "../../../src/providers/claude/auth"
import { createClaude } from "../../../src/sdk/claude"
import { createCommandCode } from "../../../src/sdk/command-code"
import { nativeFixture } from "./native-claude-fixture"

const reply = (body: string) => ({ status: 200, headers: {}, body: new TextEncoder().encode(body) })
it("keeps selected direct Command Code and trusted Ollama when Claude lookup fails at V1 setup", async () => {
  // Given
  const state = await nativeFixture()
  let lookups = 0
  const logs: Array<{ event: string; fields: Readonly<Record<string, unknown>> }> = []
  const ollama = createProviderRegistry().find((entry) => entry.id === "ollama")
  if (ollama === undefined) throw new TypeError("missing Ollama entry")
  const entries = [
    ...createProviderRegistry().filter((entry) => entry.id !== "ollama"),
    {
      ...ollama,
      isConnected: async () => true,
      createAdapter: () => ({
        providerId: parseProviderId("ollama"),
        snapshot: async () => ({
          status: "ready" as const,
          providerId: parseProviderId("ollama"),
          models: [{ id: parseModelId("local") }],
        }),
        dispose: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined,
      }),
    },
  ]
  try {
    await writeFile(
      join(state.home, "opencode", "auth.json"),
      JSON.stringify({
        anthropic: { type: "api", key: "cli-session:anthropic" },
        "command-code": { type: "api", key: "direct-command" },
        ollama: { type: "api", key: "cli-session:ollama" },
      }),
    )
    state.transport.enqueueResponse(reply('{"data":[{"id":"command-model"}]}'))
    const hooks = await buildV1Hooks({
      clock: state.clock,
      transport: state.transport,
      env: { ...state.deps.env, COMMAND_CODE_CLI_VERSION: "9.9.9" },
      authStore: state.deps.authStore,
      providers: entries,
      catalogReloadMs: 0,
      health: { initialBackoffMs: 20, maximumBackoffMs: 40 },
      npmSpecifiers: {
        claude: "file:///claude",
        "command-code": "file:///command",
        ollama: "file:///ollama",
      },
      logger: { log: (_level, event, fields) => logs.push({ event, fields }) },
      claudeAuthLookup: {
        readKeychain: async () => {
          lookups += 1
          throw new ClaudeCredentialLookupError("locked")
        },
      },
    })
    try {
      const config: Parameters<NonNullable<Hooks["config"]>>[0] = {}
      await hooks.config?.(config)
      expect(config.provider?.["claude"]).toBeUndefined()
      expect(config.provider?.["command-code"]?.models?.["command-model"]).toBeDefined()
      expect(config.provider?.["ollama"]?.models?.["local"]).toBeDefined()
      state.transport.enqueueResponse(
        reply('{"type":"text-delta","text":"healthy"}\n{"type":"finish"}'),
      )
      const result = await createCommandCode(config.provider?.["command-code"]?.options)
        .languageModel("command-model")
        .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
      expect(result.content).toContainEqual({ type: "text", text: "healthy" })
      expect(state.transport.requests.at(-1)?.headers["authorization"]).toBe(
        "Bearer direct-command",
      )
      expect(lookups).toBe(1)
      expect(
        logs.some(
          (record) =>
            record.event === "provider.credential.failed" &&
            record.fields["providerId"] === "claude",
        ),
      ).toBe(true)
      expect(JSON.stringify(logs)).not.toContain("locked")
    } finally {
      await hooks.dispose?.()
    }
  } finally {
    await state.dispose()
  }
})

it("retires a V1 Claude binding on later credential failure and recovers after backoff", async () => {
  // Given
  const state = await nativeFixture()
  const entries = createProviderRegistry().filter(
    (entry) => entry.id === "claude" || entry.id === "command-code",
  )
  const projector = createV1CatalogProjector({
    entries,
    npmSpecifiers: { claude: "file:///claude", "command-code": "file:///command" },
  })
  const config: Parameters<NonNullable<Hooks["config"]>>[0] = {}
  projector.attach(config)
  let locked = false
  let reads = 0
  const owner = createV1Owner({
    entries,
    projector,
    deps: {
      ...state.deps,
      env: { ...state.deps.env, COMMAND_CODE_CLI_VERSION: "9.9.9" },
      claudeAuthLookup: {
        readKeychain: async () => {
          reads += 1
          if (locked) throw new ClaudeCredentialLookupError("locked")
          return null
        },
      },
    },
    health: { initialBackoffMs: 20, maximumBackoffMs: 40 },
    logger: { log: () => undefined },
    snapshotTimeoutMs: 30_000,
    lifetime: new AbortController().signal,
  })
  try {
    await writeFile(
      join(state.home, "opencode", "auth.json"),
      JSON.stringify({
        anthropic: { type: "api", key: "cli-session:anthropic" },
        "command-code": { type: "api", key: "direct-command" },
      }),
    )
    state.transport.enqueueResponse(reply('{"data":[{"id":"claude-model"}]}'))
    state.transport.enqueueResponse(reply('{"data":[{"id":"command-model"}]}'))
    await owner.refresh()
    const prior = createClaude(config.provider?.["claude"]?.options).languageModel("claude-model")
    locked = true
    // When
    await owner.refresh()
    // Then
    expect(config.provider?.["claude"]).toBeUndefined()
    expect(config.provider?.["command-code"]?.models?.["command-model"]).toBeDefined()
    await expect(
      prior.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    ).rejects.toThrow()
    const failedReads = reads
    await owner.refresh()
    expect(reads).toBe(failedReads)
    locked = false
    state.clock.advanceBy(20)
    state.transport.enqueueResponse(reply('{"data":[{"id":"fresh-model"}]}'))
    await owner.refresh()
    expect(config.provider?.["claude"]?.models?.["fresh-model"]).toBeDefined()
    expect(config.provider?.["command-code"]?.models?.["command-model"]).toBeDefined()
  } finally {
    await owner.dispose()
    await state.dispose()
  }
})
