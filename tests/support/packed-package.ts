import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const stagedEntries = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "bun.lock",
  "docs",
  "package.json",
  "scripts",
  "src",
  "tsconfig.build.json",
  "tsconfig.json",
] as const

export type PackedPackage = {
  readonly tarballPath: string
  cleanup(): Promise<void>
}

export type PackCleanSourceOptions = {
  readonly projectRoot: string
  readonly beforePack?: (sourceDirectory: string) => Promise<void>
}

export class PackagePackError extends Error {
  public override readonly name = "PackagePackError"

  public constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`Clean-source package pack failed with code ${exitCode}: ${stderr.trim()}`)
  }
}

export async function packCleanSource(options: PackCleanSourceOptions): Promise<PackedPackage> {
  const root = await mkdtemp(join(tmpdir(), "opencode-ext-connector-pack-"))
  const sourceDirectory = join(root, "source")
  const artifactDirectory = join(root, "artifacts")
  const home = join(root, "home")
  const filename = "opencode-ext-connector-0.2.0.tgz"
  try {
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(artifactDirectory, { recursive: true }),
      mkdir(home, { recursive: true }),
    ])
    await Promise.all(
      stagedEntries.map((entry) =>
        cp(join(options.projectRoot, entry), join(sourceDirectory, entry), { recursive: true }),
      ),
    )
    await symlink(
      join(options.projectRoot, "node_modules"),
      join(sourceDirectory, "node_modules"),
      "dir",
    )
    await options.beforePack?.(sourceDirectory)
    const pack = Bun.spawn(
      [process.execPath, "pm", "pack", "--destination", artifactDirectory, "--quiet"],
      {
        cwd: sourceDirectory,
        env: {
          HOME: home,
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          XDG_CACHE_HOME: join(home, "cache"),
          XDG_CONFIG_HOME: join(home, "config"),
          XDG_DATA_HOME: join(home, "data"),
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    )
    const [exitCode, , stderr] = await Promise.all([
      pack.exited,
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
    ])
    if (exitCode !== 0) throw new PackagePackError(exitCode, stderr)
    return {
      tarballPath: join(artifactDirectory, filename),
      cleanup: () => rm(root, { force: true, recursive: true }),
    }
  } catch (error: unknown) {
    await rm(root, { force: true, recursive: true })
    throw error
  }
}
