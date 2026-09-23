import { afterEach, describe, expect, it } from "bun:test"
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  readXaiAccessState,
  resolveXaiAccessPath,
  type XaiAccessFile,
} from "../../../../src/providers/xai/access-state"

const temporaryDirectories: string[] = []

async function temporaryDataHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xai-access-state-"))
  temporaryDirectories.push(directory)
  await mkdir(join(directory, "opencode"))
  return directory
}

async function writeAccess(dataHome: string, value: unknown): Promise<string> {
  const path = join(dataHome, "opencode", "xai-access.json")
  await writeFile(path, JSON.stringify(value), { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("xAI consumer access state", () => {
  it("resolves XDG data before the HOME fallback", () => {
    // Given / When / Then
    expect(resolveXaiAccessPath({ HOME: "/home/test", XDG_DATA_HOME: "/xdg/data" })).toBe(
      "/xdg/data/opencode/xai-access.json",
    )
    expect(resolveXaiAccessPath({ HOME: "/home/test" })).toBe(
      "/home/test/.local/share/opencode/xai-access.json",
    )
  })

  it("rejects a relative XDG data home without inspecting the HOME fallback", async () => {
    // Given
    let opened = false

    // When
    const state = await readXaiAccessState({
      env: { HOME: "/home/test", XDG_DATA_HOME: "relative/data" },
      openFile: async () => {
        opened = true
        throw new Error("must not open an access file")
      },
    })

    // Then
    expect(resolveXaiAccessPath({ HOME: "/home/test", XDG_DATA_HOME: "relative/data" })).toBeNull()
    expect(state).toEqual({ kind: "unavailable" })
    expect(opened).toBeFalse()
  })

  it("parses an exact ready record from a private regular file", async () => {
    // Given
    const dataHome = await temporaryDataHome()
    await writeAccess(dataHome, {
      schema_version: 1,
      provider: "xai",
      state: "ready",
      access: "access-one",
      expires: 20_000,
    })

    // When
    const state = await readXaiAccessState({ env: { XDG_DATA_HOME: dataHome } })

    // Then
    expect(state).toEqual({ kind: "ready", access: "access-one", expires: 20_000 })
  })

  it.each([
    {
      schema_version: 1,
      provider: "xai",
      state: "unavailable",
    },
    {
      schema_version: 1,
      provider: "xai",
      state: "ready",
      access: "access-one",
      expires: 20_000,
      refresh: "forbidden-field",
    },
    {
      schema_version: 1,
      provider: "other",
      state: "ready",
      access: "access-one",
      expires: 20_000,
    },
  ])("fails closed for unavailable or malformed record %#", async (record) => {
    // Given
    const dataHome = await temporaryDataHome()
    await writeAccess(dataHome, record)

    // When / Then
    await expect(readXaiAccessState({ env: { XDG_DATA_HOME: dataHome } })).resolves.toEqual({
      kind: "unavailable",
    })
  })

  it("rejects symbolic links and multiply-linked files", async () => {
    // Given
    const symlinkHome = await temporaryDataHome()
    const target = join(symlinkHome, "target.json")
    await writeFile(target, "{}", { mode: 0o600 })
    await symlink(target, join(symlinkHome, "opencode", "xai-access.json"))
    const linkedHome = await temporaryDataHome()
    const linkedPath = await writeAccess(linkedHome, {
      schema_version: 1,
      provider: "xai",
      state: "unavailable",
    })
    await link(linkedPath, join(linkedHome, "duplicate.json"))

    // When
    const results = await Promise.all([
      readXaiAccessState({ env: { XDG_DATA_HOME: symlinkHome } }),
      readXaiAccessState({ env: { XDG_DATA_HOME: linkedHome } }),
    ])

    // Then
    expect(results).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }])
  })

  it("rejects non-private mode and a wrong owner when uid is available", async () => {
    // Given
    const dataHome = await temporaryDataHome()
    const path = await writeAccess(dataHome, {
      schema_version: 1,
      provider: "xai",
      state: "unavailable",
    })
    await chmod(path, 0o640)
    const wrongOwner: XaiAccessFile = {
      stat: async () => ({ regular: true, links: 1, mode: 0o600, ownerUid: 2000 }),
      readText: async () =>
        JSON.stringify({ schema_version: 1, provider: "xai", state: "unavailable" }),
      close: async () => undefined,
    }

    // When
    const results = await Promise.all([
      readXaiAccessState({ env: { XDG_DATA_HOME: dataHome } }),
      readXaiAccessState({
        env: { HOME: "/home/test" },
        currentUid: () => 1000,
        openFile: async () => wrongOwner,
      }),
    ])

    // Then
    expect(results).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }])
  })
})
