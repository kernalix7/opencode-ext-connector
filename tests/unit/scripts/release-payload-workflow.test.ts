import { describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

const stepSchema = z
  .object({
    run: z.string().optional(),
    if: z.string().optional(),
    "continue-on-error": z.boolean().optional(),
  })
  .loose()
const workflowSchema = z.object({
  jobs: z.record(
    z.string(),
    z
      .object({
        steps: z.array(stepSchema),
        if: z.string().optional(),
        "continue-on-error": z.boolean().optional(),
      })
      .loose(),
  ),
})

async function execute(script: string): Promise<number> {
  const root = await mkdtemp(join(tmpdir(), "payload-workflow-"))
  try {
    await mkdir(join(root, "bin"))
    const fakeBun = join(root, "bin/bun")
    await writeFile(
      fakeBun,
      '#!/bin/bash\nif [ "$1" = pm ]; then touch release/test.tgz; exit 0; fi\nif [ "$1" = scripts/check-release-payload.ts ]; then exit 43; fi\nexit 0\n',
    )
    await chmod(fakeBun, 0o755)
    const result = Bun.spawnSync(["bash", "-c", `${script}\ntouch bypassed`], {
      cwd: root,
      env: { PATH: `${join(root, "bin")}:/usr/bin:/bin`, HOME: root },
    })
    return result.exitCode
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

for (const [file, jobName] of [
  ["ci", "check"],
  ["release", "verify"],
] as const) {
  describe(`${file} publication payload gate`, () => {
    it("blocks subsequent delivery when the final archive guard fails", async () => {
      // Given
      const source = await Bun.file(
        new URL(`../../../.github/workflows/${file}.yml`, import.meta.url),
      ).text()
      const workflow = workflowSchema.parse(Bun.YAML.parse(source))
      const job = workflow.jobs[jobName]
      const step = job?.steps.find((entry) => entry.run?.includes("check-release-payload.ts"))
      const script = z.string().parse(step?.run)
      expect(job?.if).toBeUndefined()
      expect(job?.["continue-on-error"]).not.toBe(true)
      expect(step?.if).toBeUndefined()
      expect(step?.["continue-on-error"]).not.toBe(true)
      // When
      const exitCode = await execute(script)
      // Then
      expect(exitCode).toBe(43)
    })

    for (const mutation of ["remove guard", "ignore failure", "conditional bypass"] as const) {
      it(`detects a workflow bypass when ${mutation} is introduced`, async () => {
        // Given
        const source = await Bun.file(
          new URL(`../../../.github/workflows/${file}.yml`, import.meta.url),
        ).text()
        const workflow = workflowSchema.parse(Bun.YAML.parse(source))
        const script = z
          .string()
          .parse(
            workflow.jobs[jobName]?.steps.find((entry) =>
              entry.run?.includes("check-release-payload.ts"),
            )?.run,
          )
        const mutant = script.replace(/^.*bun scripts\/check-release-payload\.ts.*$/m, (line) => {
          switch (mutation) {
            case "remove guard":
              return "true"
            case "ignore failure":
              return `${line} || true`
            case "conditional bypass":
              return `if false; then ${line}; fi`
            default:
              return mutation satisfies never
          }
        })
        // When
        const exitCode = await execute(mutant)
        // Then
        expect(exitCode).toBe(0)
      })
    }
  })
}
