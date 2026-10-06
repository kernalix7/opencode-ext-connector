import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { endpointFrom, listPlugins, readUntil } from "../support/opencode-v2-api"
import {
  openCodeV2Binary,
  requireOpenCodeV2Binary,
  runOpenCodeV2,
} from "../support/opencode-v2-session"

const fixtureId = "fixture-v2-harness"

describe.skipIf(openCodeV2Binary() === undefined)("OpenCode V2 serve harness", () => {
  it("loads a directory-url default export and stops the owned server", async () => {
    // Given
    const binary = requireOpenCodeV2Binary()
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "opencode-v2-fixture-"))
    const fixturePath = join(fixtureDirectory, "server.js")
    await writeFile(
      fixturePath,
      `export default { id: ${JSON.stringify(fixtureId)}, setup() { return () => undefined } }\n`,
      "utf8",
    )
    const config = {
      share: "disabled",
      update: "disable",
      plugins: [{ package: pathToFileURL(fixtureDirectory).href }],
    }

    try {
      // When
      await runOpenCodeV2({
        binary,
        config,
        run: async (session) => {
          const plugins = await readUntil({
            label: "fixture plugin",
            read: () => listPlugins(endpointFrom(session)),
            ready: (items) =>
              items.some((item) => item.id === fixtureId && item.status === "active"),
            timeoutMs: 15_000,
          })
          const url = session.server.url
          await session.server.close()

          // Then
          expect(plugins.some((item) => item.id === fixtureId && item.status === "active")).toBe(
            true,
          )
          expect(session.server.exitCode).toBe(await session.server.exited)
          await expect(fetch(url, { signal: AbortSignal.timeout(1_000) })).rejects.toBeDefined()
        },
      })
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true })
    }
  }, 30_000)
})
