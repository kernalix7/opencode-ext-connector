import { describe, expect, it } from "bun:test"

import { z } from "zod"

const stepSchema = z
  .object({
    run: z.string().optional(),
    uses: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()

const jobSchema = z
  .object({
    concurrency: z.unknown().optional(),
    if: z.string(),
    needs: z.string().optional(),
    permissions: z.record(z.string(), z.string()),
    steps: z.array(stepSchema),
  })
  .loose()

const workflowSchema = z.object({
  jobs: z.record(z.string(), z.unknown()),
  on: z.object({ workflow_dispatch: z.object({}).strict() }).loose(),
})

const workflowPath = new URL("../../../.github/workflows/release.yml", import.meta.url)

function scripts(job: z.infer<typeof jobSchema>): readonly string[] {
  return job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run]))
}

describe("v0.3.3 release recovery", () => {
  it("isolates verification from the OIDC-only publish job", async () => {
    // Given
    const source = await Bun.file(workflowPath).text()
    const workflow = workflowSchema.parse(Bun.YAML.parse(source))

    // When
    const verify = jobSchema.parse(workflow.jobs["recover-v0-3-3-verify"])
    const publish = jobSchema.parse(workflow.jobs["recover-v0-3-3-publish"])
    const verifyValues = JSON.stringify(verify)
    const publishValues = JSON.stringify(publish)

    // Then
    expect(workflow.on.workflow_dispatch).toEqual({})
    expect(verify.if).toBe(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    )
    expect(publish.if).toBe(verify.if)
    expect(verify.permissions).toEqual({ contents: "read" })
    expect(publish.permissions).toEqual({ "id-token": "write" })
    expect(publish.needs).toBe("recover-v0-3-3-verify")
    expect(verifyValues).not.toContain("id-token")
    expect(verifyValues).toContain("edf38582784dbc809c4126b42eb9238f65603710")
    expect(verifyValues).toContain("db7bdb9369c2db8b972fde4b006b6526bb2398e5")
    expect(verifyValues).toContain(
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    )
    expect(publishValues).toContain(
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
    )
    expect(publishValues).not.toContain("actions/checkout")
    expect(publishValues).not.toContain("oven-sh/setup-bun")
    expect(scripts(publish).at(-1)?.trim()).toBe(
      "npm publish ./source --ignore-scripts --provenance --access public",
    )
    for (const forbidden of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "_authToken", ".npmrc"]) {
      expect(`${verifyValues}${publishValues}`).not.toContain(forbidden)
    }
  })
})
