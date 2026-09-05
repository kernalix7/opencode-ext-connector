import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createProviderRegistry } from "../../../src/opencode/providers"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function claudeConfigDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "claude-version-discovery-"))
  roots.push(root)
  const configDir = join(root, "claude")
  await mkdir(configDir, { recursive: true })
  await writeFile(
    join(configDir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "shared-access",
        refreshToken: "shared-refresh",
        expiresAt: 4_102_444_800_000,
      },
    }),
    "utf8",
  )
  return configDir
}

function jsonResponse(payload: unknown): {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: Uint8Array
} {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify(payload)),
  }
}

describe("Claude without a local CLI", () => {
  it("publishes the catalog using the latest published Claude Code version", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(jsonResponse({ version: "2.1.261" }))
    transport.enqueueResponse(jsonResponse({ data: [{ id: "claude-sonnet-4-6" }] }))
    const entry = createProviderRegistry().find((candidate) => candidate.id === "claude")
    if (entry === undefined) {
      throw new Error("expected Claude provider entry")
    }
    const adapter = entry.createAdapter({
      env: { CLAUDE_CONFIG_DIR: await claudeConfigDir(), PATH: "" },
      transport,
      clock: new FakeClock(),
      authStore: { matchAuth: async () => ({ kind: "oauth" }) },
      writeBackCredentials: false,
    })

    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)

    // Then
    expect(snapshot.status).toBe("ready")
    expect(transport.requests.map((request) => request.url)).toEqual([
      "https://registry.npmjs.org/%40anthropic-ai%2Fclaude-code/latest",
      "https://api.anthropic.com/v1/models",
    ])
    expect(transport.requests[1]?.headers["user-agent"]).toBe(
      "claude-cli/2.1.261 (external, sdk-cli)",
    )
  })

  it("keeps the catalog unavailable when no version source responds", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueError(new Error("offline"))
    const entry = createProviderRegistry().find((candidate) => candidate.id === "claude")
    if (entry === undefined) {
      throw new Error("expected Claude provider entry")
    }
    const adapter = entry.createAdapter({
      env: { CLAUDE_CONFIG_DIR: await claudeConfigDir(), PATH: "" },
      transport,
      clock: new FakeClock(),
      authStore: { matchAuth: async () => ({ kind: "oauth" }) },
      writeBackCredentials: false,
    })

    // When
    const snapshot = await adapter.snapshot(new AbortController().signal)

    // Then
    expect(snapshot.status).toBe("unavailable")
    expect(transport.requests).toHaveLength(1)
  })
})
