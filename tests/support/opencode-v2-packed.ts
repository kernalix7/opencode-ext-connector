import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { OpenCodeV2EntryMissingError } from "./opencode-v2-session"
import { type PackedPackage, packCleanSource } from "./packed-package"

export type PackedV2Plugin = {
  readonly directory: string
  readonly fileUrl: string
  readonly packageUrl: string
  cleanup(): Promise<void>
}

class PackedV2ExtractError extends Error {
  public override readonly name = "PackedV2ExtractError"

  public constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`Packed V2 extraction failed with code ${exitCode}: ${stderr}`)
  }
}

export async function packV2Plugin(): Promise<PackedV2Plugin> {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url))
  const root = await mkdtemp(join(tmpdir(), "opencode-v2-packed-"))
  let packed: PackedPackage | undefined
  try {
    packed = await packCleanSource({ projectRoot })
    const extract = Bun.spawn(["tar", "-xzf", packed.tarballPath, "-C", root], {
      stderr: "pipe",
      stdout: "ignore",
    })
    const [exitCode, stderr] = await Promise.all([
      extract.exited,
      new Response(extract.stderr).text(),
    ])
    if (exitCode !== 0) throw new PackedV2ExtractError(exitCode, stderr)
    const packageDirectory = join(root, "package")
    await symlink(join(projectRoot, "node_modules"), join(packageDirectory, "node_modules"), "dir")
    const entryPath = join(packageDirectory, "dist", "v2.js")
    if (!(await Bun.file(entryPath).exists())) throw new OpenCodeV2EntryMissingError(entryPath)
    const fileUrl = pathToFileURL(entryPath).href
    // CLI 2.0.20 configured local plugins must be directories with a server entrypoint.
    const directory = join(root, "plugin")
    await mkdir(directory)
    await writeFile(
      join(directory, "server.js"),
      `export { default } from ${JSON.stringify(fileUrl)};\n`,
    )
    return {
      directory,
      fileUrl,
      packageUrl: pathToFileURL(join(packageDirectory, "dist", "v2-entry")).href,
      cleanup: () => rm(root, { recursive: true, force: true }),
    }
  } catch (error: unknown) {
    await rm(root, { recursive: true, force: true })
    throw error
  } finally {
    await packed?.cleanup()
  }
}
