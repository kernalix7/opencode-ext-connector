import { afterEach, describe, expect, it } from "bun:test"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ClaudeCredentialSymlinkError,
  writeClaudePrivateFile,
} from "../../../../src/providers/claude/atomic-private-file"

const roots: string[] = []

async function isolatedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "claude-writeback-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe("writeClaudePrivateFile", () => {
  it("atomically replaces a permissive credential file with mode 0600", async () => {
    // Given
    const root = await isolatedRoot()
    const path = join(root, ".credentials.json")
    await writeFile(path, "old", { mode: 0o644 })
    await chmod(path, 0o644)

    // When
    await writeClaudePrivateFile(path, "new")

    // Then
    expect(await readFile(path, "utf8")).toBe("new")
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
  })

  it("installs a new regular file with mode 0600 in a new destination directory", async () => {
    // Given
    const root = await isolatedRoot()
    const directory = join(root, "nested")
    const path = join(directory, ".credentials.json")

    // When
    await writeClaudePrivateFile(path, "new")

    // Then
    const installed = await lstat(path)
    expect(installed.isFile()).toBe(true)
    expect(installed.mode & 0o777).toBe(0o600)
    expect(await readdir(directory)).toEqual([".credentials.json"])
  })

  it("rejects a symbolic-link destination without modifying its target", async () => {
    // Given
    const root = await isolatedRoot()
    const target = join(root, "target.json")
    const path = join(root, ".credentials.json")
    await writeFile(target, "unchanged")
    await symlink(target, path)

    // When
    const write = writeClaudePrivateFile(path, "new")

    // Then
    await expect(write).rejects.toBeInstanceOf(ClaudeCredentialSymlinkError)
    expect(await readFile(target, "utf8")).toBe("unchanged")
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
  })

  it("removes its temporary file when installation fails", async () => {
    // Given
    const root = await isolatedRoot()
    const path = join(root, ".credentials.json")
    await mkdir(path)

    // When
    const write = writeClaudePrivateFile(path, "new")

    // Then
    await expect(write).rejects.toBeInstanceOf(Error)
    expect(await readdir(root)).toEqual([".credentials.json"])
  })
})
