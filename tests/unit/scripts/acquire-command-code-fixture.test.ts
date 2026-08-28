import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  acquireCommandCodeFixture,
  COMMAND_CODE_FIXTURE_DIRECTORY,
} from "../../../scripts/acquire-command-code-fixture"

describe("acquireCommandCodeFixture", () => {
  it("verifies the checked-in fixture without a network request by default", async () => {
    // Given
    let fetchCount = 0

    // When
    await acquireCommandCodeFixture([], {
      fetchArtifact: async () => {
        fetchCount += 1
        throw new Error("network access is forbidden during verification")
      },
    })

    // Then
    expect(fetchCount).toBe(0)
  })

  it("rejects fixture byte drift during explicit verification", async () => {
    // Given
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "command-code-fixture-"))
    const manifest = await readFile(join(COMMAND_CODE_FIXTURE_DIRECTORY, "manifest.json"))
    await writeFile(join(fixtureDirectory, "manifest.json"), manifest)
    await writeFile(join(fixtureDirectory, "cli.mjs"), "drifted")

    // When
    const verification = acquireCommandCodeFixture(["--verify"], { fixtureDirectory })

    // Then
    await expect(verification).rejects.toThrow("sha256")
  })

  it("fetches the pinned source only for an explicit refresh", async () => {
    // Given
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "command-code-refresh-"))
    const fixtureBytes = await readFile(join(COMMAND_CODE_FIXTURE_DIRECTORY, "cli.mjs"))
    let fetchCount = 0

    // When
    await acquireCommandCodeFixture(["--refresh"], {
      fixtureDirectory,
      fetchArtifact: async () => {
        fetchCount += 1
        return fixtureBytes
      },
    })

    // Then
    expect(fetchCount).toBe(1)
    await expect(
      acquireCommandCodeFixture(["--verify"], { fixtureDirectory }),
    ).resolves.toBeUndefined()
  })
})
