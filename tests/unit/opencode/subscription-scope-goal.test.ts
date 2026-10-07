import { expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONNECTOR_AISDK_PACKAGE } from "../../../src/opencode/v2-catalog"
import { setupV2Connector } from "../../../src/opencode/v2-setup"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { createV2Host, credentialConnection } from "./v2-host"

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

it.each([
  {
    provider: "claude",
    integration: "anthropic",
    marker: "cli-session:anthropic",
    path: ".credentials.json",
    change: "replace",
  },
  {
    provider: "claude",
    integration: "anthropic",
    marker: "cli-session:anthropic",
    path: ".credentials.json",
    change: "remove",
  },
  {
    provider: "command-code",
    integration: "command-code",
    marker: "cli-session:command-code",
    path: ".commandcode/auth.json",
    change: "replace",
  },
  {
    provider: "command-code",
    integration: "command-code",
    marker: "cli-session:command-code",
    path: ".commandcode/auth.json",
    change: "remove",
  },
] as const)(
  "revokes a captured $provider model before request after source $change",
  async (fixture) => {
    // Given
    const home = await mkdtemp(join(tmpdir(), "host-source-"))
    try {
      await mkdir(join(home, ".commandcode"))
      const source = join(home, fixture.path)
      const credential = (token: string): string =>
        fixture.provider === "claude"
          ? JSON.stringify({
              claudeAiOauth: {
                accessToken: token,
                refreshToken: "refresh",
                expiresAt: 1_900_000_000_000,
              },
            })
          : JSON.stringify({ apiKey: token })
      await writeFile(source, credential("first-account"))
      const host = createV2Host({
        pluginOptions: {
          providers: [fixture.provider],
          credentialRole: "reader",
          catalogReloadMs: 0,
        },
      })
      host.setConnection(fixture.integration, credentialConnection("selected-account", "key"))
      host.setKey("selected-account", fixture.marker)
      const transport = new FakeHttpTransport()
      transport.enqueueResponse({
        status: 200,
        headers: {},
        body: encode({ data: [{ id: "fixture-model" }] }),
      })
      const close = await setupV2Connector(host, {
        env: {
          HOME: home,
          CLAUDE_CONFIG_DIR: home,
          ANTHROPIC_CLI_VERSION: "9.9.9",
          COMMAND_CODE_CLI_VERSION: "9.9.9",
          PATH: "",
        },
        clock: new FakeClock(),
        createTransport: () => transport,
        claudeAuthLookup: { readKeychain: async () => null },
      })
      try {
        const hook = host.hooks.find(
          (candidate) => candidate.name === "language" && candidate.providerID === fixture.provider,
        )
        const model = hook?.invoke({
          providerID: fixture.provider,
          modelID: "fixture-model",
          modelPackage: CONNECTOR_AISDK_PACKAGE,
        }).language
        if (model === undefined) throw new Error("No published subscription model")
        const before = transport.requests.length
        if (fixture.change === "replace") await writeFile(source, credential("second-account"))
        else await rm(source)
        // When / Then
        await expect(
          model.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "private" }] }],
          }),
        ).rejects.toThrow()
        expect(transport.requests).toHaveLength(before)
        await host.provider.reload()
        expect(host.providers().some((record) => record.provider.id === fixture.provider)).toBe(
          false,
        )
      } finally {
        await close()
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  },
)
