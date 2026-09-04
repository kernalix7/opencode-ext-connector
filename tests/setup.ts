import { afterAll } from "bun:test"
import { join } from "node:path"

import { prepareTestPackage, TEST_PACKAGE_ROOT_ENV } from "./support/test-package"

class TestPackageBuildError extends Error {
  public override readonly name = "TestPackageBuildError"

  public constructor(exitCode: number) {
    super(`Test package build failed with code ${exitCode}`)
  }
}

const build = Bun.spawn([process.execPath, "run", "build"], {
  cwd: join(import.meta.dir, ".."),
  stderr: "inherit",
  stdout: "inherit",
})
const exitCode = await build.exited
if (exitCode !== 0) throw new TestPackageBuildError(exitCode)

const testPackage = await prepareTestPackage()
process.env[TEST_PACKAGE_ROOT_ENV] = testPackage.root

afterAll(async () => {
  await testPackage.cleanup()
})
