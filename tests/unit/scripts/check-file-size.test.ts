import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  countPureLines,
  findOversizedFiles,
  findTypeScriptFiles,
} from "../../../scripts/check-file-size"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe("countPureLines", () => {
  it("counts code-bearing lines while excluding blank and comment-only lines", () => {
    // Given
    const sourceText = `
// comment
const first = 1
/* block
 * comment
 */
const second = first + 1 // inline comment
`

    // When
    const count = countPureLines(sourceText)

    // Then
    expect(count).toBe(2)
  })
})

describe("findOversizedFiles", () => {
  it("reports TypeScript files above the configured pure LOC maximum", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-ext-loc-"))
    temporaryDirectories.push(directory)
    const filePath = join(directory, "oversized.ts")
    await writeFile(filePath, "const first = 1\nconst second = 2\n", "utf8")

    // When
    const violations = await findOversizedFiles([directory], 1)

    // Then
    expect(violations).toEqual([{ filePath, maximumLines: 1, pureLines: 2 }])
  })
})

describe("findTypeScriptFiles", () => {
  it("ignores a broken symlink with an ignored directory name", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-ext-files-"))
    temporaryDirectories.push(directory)
    const filePath = join(directory, "source.ts")
    await writeFile(filePath, "export const value = 1\n", "utf8")
    await symlink(join(directory, "missing-index"), join(directory, ".codegraph"))

    // When
    const files = await findTypeScriptFiles([directory])

    // Then
    expect(files).toEqual([filePath])
  })
})
