import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { acquireCommandCodeFixture } from "../../../scripts/acquire-command-code-fixture"

const SYNTHETIC_TEXT = "synthetic command-code fixture"
const SYNTHETIC_BYTES = new TextEncoder().encode(SYNTHETIC_TEXT)
const SYNTHETIC_SHA256 = createHash("sha256").update(SYNTHETIC_BYTES).digest("hex")

describe("acquireCommandCodeFixture", () => {
  it("verifies a synthetic fixture without a network request", async () => {
    // Given
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "command-code-verify-"))
    await acquireCommandCodeFixture(["--refresh"], {
      fixtureDirectory,
      fetchArtifact: async () => SYNTHETIC_BYTES,
      expectedSha256: SYNTHETIC_SHA256,
    })
    let fetchCount = 0

    // When
    await acquireCommandCodeFixture(["--verify"], {
      fixtureDirectory,
      fetchArtifact: async () => {
        fetchCount += 1
        throw new Error("network access is forbidden during verification")
      },
      expectedSha256: SYNTHETIC_SHA256,
    })

    // Then
    expect(fetchCount).toBe(0)
  })

  it("rejects fixture byte drift during explicit verification", async () => {
    // Given
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "command-code-fixture-"))
    await acquireCommandCodeFixture(["--refresh"], {
      fixtureDirectory,
      fetchArtifact: async () => SYNTHETIC_BYTES,
      expectedSha256: SYNTHETIC_SHA256,
    })
    await writeFile(join(fixtureDirectory, "cli.mjs"), "drifted")

    // When
    const verification = acquireCommandCodeFixture(["--verify"], {
      fixtureDirectory,
      expectedSha256: SYNTHETIC_SHA256,
    })

    // Then
    await expect(verification).rejects.toThrow("sha256")
  })

  it("fetches the pinned source only for an explicit refresh", async () => {
    // Given
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "command-code-refresh-"))
    const fetchedSources: string[] = []

    // When
    await acquireCommandCodeFixture(["--refresh"], {
      fixtureDirectory,
      fetchArtifact: async (source) => {
        fetchedSources.push(source)
        return SYNTHETIC_BYTES
      },
      expectedSha256: SYNTHETIC_SHA256,
    })

    // Then
    expect(fetchedSources).toEqual(["https://unpkg.com/command-code@1.32.1/dist/cli.mjs"])
    expect(await readFile(join(fixtureDirectory, "cli.mjs"), "utf8")).toBe(SYNTHETIC_TEXT)
  })

  it("preserves the pinned production digest when no test digest is injected", async () => {
    // Given
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "command-code-production-hash-"))

    // When
    const refresh = acquireCommandCodeFixture(["--refresh"], {
      fixtureDirectory,
      fetchArtifact: async () => SYNTHETIC_BYTES,
    })

    // Then
    await expect(refresh).rejects.toThrow(
      "sha256 expected d404aa1e66d9e4adbfa0f998d328609b50cea5d78812cfe119ad2da529c08988",
    )
  })

  it("ignores only the locally refreshed CLI artifact", async () => {
    // Given
    const gitignorePath = join(import.meta.dir, "..", "..", "..", ".gitignore")

    // When
    const rules = (await readFile(gitignorePath, "utf8")).split("\n")

    // Then
    expect(rules).toContain("/tests/fixtures/command-code/1.32.1/cli.mjs")
    expect(rules).not.toContain("/tests/fixtures/command-code/1.32.1/")
  })
})
