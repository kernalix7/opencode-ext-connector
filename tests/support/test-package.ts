import { copyFile, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import { buildCursorH2Bridge } from "../../scripts/build-cursor-h2-bridge"

export const TEST_PACKAGE_ROOT_ENV = "OPENCODE_EXT_CONNECTOR_TEST_PACKAGE_ROOT"

const TestPackageRootSchema = z.string().min(1).brand("TestPackageRoot")
const TestPackageDistSchema = z.string().min(1).brand("TestPackageDist")
const TestPackageEnvironmentSchema = z.object({
  [TEST_PACKAGE_ROOT_ENV]: TestPackageRootSchema,
})

export type TestPackageRoot = z.infer<typeof TestPackageRootSchema>
export type TestPackageDist = z.infer<typeof TestPackageDistSchema>

export type TestPackage = {
  readonly root: TestPackageRoot
  readonly dist: TestPackageDist
  readonly cleanup: () => Promise<void>
}

export class TestPackageBuildError extends Error {
  public override readonly name = "TestPackageBuildError"

  public constructor(readonly exitCode: number) {
    super(`Test package build failed with code ${exitCode}`)
  }
}

const projectRoot = join(import.meta.dir, "..", "..")

export function getTestPackageRoot(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TestPackageRoot {
  return TestPackageEnvironmentSchema.parse(environment)[TEST_PACKAGE_ROOT_ENV]
}

export function getTestPackageDist(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TestPackageDist {
  return TestPackageDistSchema.parse(join(getTestPackageRoot(environment), "dist"))
}

export async function prepareTestPackage(): Promise<TestPackage> {
  const root = TestPackageRootSchema.parse(
    await mkdtemp(join(tmpdir(), "opencode-ext-connector-test-package-")),
  )
  const dist = TestPackageDistSchema.parse(join(root, "dist"))
  let cleanupPromise: Promise<void> | undefined
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= rm(root, { force: true, recursive: true })
    return cleanupPromise
  }

  try {
    await copyFile(join(projectRoot, "package.json"), join(root, "package.json"))
    await symlink(join(projectRoot, "node_modules"), join(root, "node_modules"), "junction")
    const compiler = Bun.spawn(
      [
        process.execPath,
        join(projectRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        join(projectRoot, "tsconfig.build.json"),
        "--outDir",
        dist,
      ],
      { cwd: projectRoot, stderr: "inherit", stdout: "inherit" },
    )
    const exitCode = await compiler.exited
    if (exitCode !== 0) throw new TestPackageBuildError(exitCode)
    await buildCursorH2Bridge({ outdir: join(dist, "providers", "cursor") })
    return { root, dist, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
