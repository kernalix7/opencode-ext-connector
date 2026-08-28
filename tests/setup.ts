import { join } from "node:path"

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
