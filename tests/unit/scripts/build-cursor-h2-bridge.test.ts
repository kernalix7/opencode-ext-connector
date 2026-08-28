import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildCursorH2Bridge } from "../../../scripts/build-cursor-h2-bridge"

const temporaryDirectories: string[] = []
const productionDist = join(import.meta.dir, "..", "..", "..", "dist")

async function findSourceMapPaths(directory: string): Promise<readonly string[]> {
  const paths: string[] = []
  for await (const path of new Bun.Glob("**/*.map").scan({ cwd: directory, onlyFiles: true })) {
    paths.push(path)
  }
  return paths.sort()
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe("buildCursorH2Bridge", () => {
  it("builds only the private Node bridge without source maps", async () => {
    // Given
    const outdir = await mkdtemp(join(tmpdir(), "opencode-ext-h2-bridge-"))
    temporaryDirectories.push(outdir)

    // When
    await buildCursorH2Bridge({ outdir })

    // Then
    expect(await readdir(outdir)).toEqual(["h2-bridge.js"])
  })
})

describe("production source maps", () => {
  it("finds runtime and declaration maps by artifact path", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-ext-source-maps-"))
    temporaryDirectories.push(directory)
    await mkdir(join(directory, "types"))
    await Promise.all([
      writeFile(join(directory, "runtime.js.map"), "{}"),
      writeFile(join(directory, "types", "index.d.ts.map"), "{}"),
    ])

    // When
    const paths = await findSourceMapPaths(directory)

    // Then
    expect(paths).toEqual(["runtime.js.map", "types/index.d.ts.map"])
  })

  it("emits no runtime or declaration maps into production dist", async () => {
    // Given
    const dist = productionDist

    // When
    const paths = await findSourceMapPaths(dist)

    // Then
    expect(paths).toEqual([])
  })
})
