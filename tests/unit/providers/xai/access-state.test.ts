import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  readXaiAccessState,
  resolveXaiAccessPath,
} from "../../../../src/providers/xai/access-state"

const directories: string[] = []
const ready = {
  schema_version: 1,
  provider: "xai",
  state: "ready",
  access: "synthetic-access",
  expires: 0,
}
const invalidRecords: unknown[] = [
  { ...ready, refresh: "forbidden" },
  { ...ready, extra: true },
  { ...ready, access: "" },
  { ...ready, expires: -1 },
  { ...ready, expires: 1.5 },
  { ...ready, provider: "other" },
  { ...ready, schema_version: 2 },
  { schema_version: 1, provider: "xai", state: "unavailable" },
  { schema_version: 1, provider: "xai", state: "unavailable", access: "forbidden" },
  { schema_version: 1, provider: "xai", state: "unavailable", refresh: "forbidden" },
  { schema_version: 1, provider: "xai", state: "unknown" },
]

async function dataHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xai-reader-"))
  directories.push(directory)
  await mkdir(join(directory, "opencode"))
  return directory
}

async function put(directory: string, value: unknown): Promise<string> {
  const path = join(directory, "opencode", "xai-access.json")
  await writeFile(path, JSON.stringify(value), { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe("xAI access-state filesystem reader", () => {
  it("reads an exact ready record, including an expired timestamp, from XDG", async () => {
    // Given
    const directory = await dataHome()
    await put(directory, ready)
    // When
    const state = await readXaiAccessState({ env: { XDG_DATA_HOME: directory } })
    // Then
    expect(state).toEqual({ kind: "ready", access: "synthetic-access", expires: 0 })
  })

  it("prefers absolute XDG and fails closed on relative XDG instead of falling back", async () => {
    // Given
    const home = await dataHome()
    const xdg = await dataHome()
    await mkdir(join(home, ".local", "share", "opencode"), { recursive: true })
    await put(xdg, ready)
    await writeFile(
      join(home, ".local", "share", "opencode", "xai-access.json"),
      JSON.stringify(ready),
      { mode: 0o600 },
    )
    // When
    const preferred = await readXaiAccessState({ env: { HOME: home, XDG_DATA_HOME: xdg } })
    const rejected = await readXaiAccessState({ env: { HOME: home, XDG_DATA_HOME: "relative" } })
    // Then
    expect(resolveXaiAccessPath({ HOME: home, XDG_DATA_HOME: xdg })).toBe(
      join(xdg, "opencode", "xai-access.json"),
    )
    expect(resolveXaiAccessPath({ HOME: home, XDG_DATA_HOME: "relative" })).toBeNull()
    expect(preferred).toEqual({ kind: "ready", access: "synthetic-access", expires: 0 })
    expect(rejected).toEqual({ kind: "unavailable" })
  })

  it("reads the absolute HOME fallback without a data-home override", async () => {
    // Given
    const home = await dataHome()
    await mkdir(join(home, ".local", "share", "opencode"), { recursive: true })
    await writeFile(
      join(home, ".local", "share", "opencode", "xai-access.json"),
      JSON.stringify(ready),
      { mode: 0o600 },
    )
    // When
    const state = await readXaiAccessState({ env: { HOME: home } })
    // Then
    expect(state.kind).toBe("ready")
  })

  it("rereads replaced records and does not cache a prior access value", async () => {
    // Given
    const directory = await dataHome()
    const path = await put(directory, ready)
    const first = await readXaiAccessState({ env: { XDG_DATA_HOME: directory } })
    // When
    await writeFile(path, JSON.stringify({ ...ready, access: "replacement" }), { mode: 0o600 })
    const second = await readXaiAccessState({ env: { XDG_DATA_HOME: directory } })
    // Then
    expect(first).toEqual({ kind: "ready", access: "synthetic-access", expires: 0 })
    expect(second).toEqual({ kind: "ready", access: "replacement", expires: 0 })
  })

  it.each(invalidRecords)("rejects a non-contract access record %#", async (record) => {
    // Given
    const directory = await dataHome()
    await put(directory, record)
    // When
    const state = await readXaiAccessState({ env: { XDG_DATA_HOME: directory } })
    // Then
    expect(state).toEqual({ kind: "unavailable" })
  })

  it("rejects symlinks, hardlinks, public modes and directories", async () => {
    // Given
    const symbolic = await dataHome()
    const target = join(symbolic, "target")
    await writeFile(target, JSON.stringify(ready), { mode: 0o600 })
    await symlink(target, join(symbolic, "opencode", "xai-access.json"))
    const hard = await dataHome()
    await link(await put(hard, ready), join(hard, "second"))
    const publicHome = await dataHome()
    await chmod(await put(publicHome, ready), 0o640)
    const directory = await dataHome()
    await mkdir(join(directory, "opencode", "xai-access.json"))
    // When
    const states = await Promise.all(
      [symbolic, hard, publicHome, directory].map((home) =>
        readXaiAccessState({ env: { XDG_DATA_HOME: home } }),
      ),
    )
    // Then
    expect(states).toEqual(Array.from({ length: 4 }, () => ({ kind: "unavailable" })))
  })

  it("does not block when the access path is a FIFO without a writer", async () => {
    // Given
    const directory = await dataHome()
    const fifo = join(directory, "opencode", "xai-access.json")
    const result = spawnSync("/usr/bin/mkfifo", [fifo])
    expect(result.status).toBe(0)
    // When
    const state = await readXaiAccessState({ env: { XDG_DATA_HOME: directory } })
    // Then
    expect(state).toEqual({ kind: "unavailable" })
  }, 2000)
})
