import { describe, expect, it } from "bun:test"

import { z } from "zod"

const stepSchema = z
  .object({
    if: z.string().optional(),
    run: z.string().optional(),
    uses: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()

const jobSchema = z
  .object({
    concurrency: z.object({ "cancel-in-progress": z.boolean(), group: z.string() }),
    if: z.string(),
    permissions: z.record(z.string(), z.string()),
    steps: z.array(stepSchema),
  })
  .loose()

const workflowSchema = z.object({
  jobs: z.record(z.string(), z.unknown()),
  on: z.object({ workflow_dispatch: z.object({}).strict() }).loose(),
})

const workflowPath = new URL("../../../.github/workflows/release.yml", import.meta.url)

describe("v0.3.3 release recovery", () => {
  it("routes a manual dispatch to the pinned OIDC recovery job", async () => {
    // Given
    const source = await Bun.file(workflowPath).text()
    const workflow = workflowSchema.parse(Bun.YAML.parse(source))

    // When
    const recovery = jobSchema.parse(workflow.jobs["recover-v0-3-3"])
    const serialized = JSON.stringify(recovery)
    const scripts = recovery.steps.flatMap((step) => (step.run === undefined ? [] : [step.run]))

    // Then
    expect(workflow.on.workflow_dispatch).toEqual({})
    expect(recovery.if).toBe("github.event_name == 'workflow_dispatch'")
    expect(recovery.permissions).toEqual({ contents: "read", "id-token": "write" })
    expect(recovery.concurrency).toEqual({
      "cancel-in-progress": false,
      group: "recover-opencode-ext-connector-v0.3.3",
    })
    expect(serialized).toContain("edf38582784dbc809c4126b42eb9238f65603710")
    expect(serialized).toContain("db7bdb9369c2db8b972fde4b006b6526bb2398e5")
    expect(
      scripts.filter((run) => run.includes("npm view opencode-ext-connector versions")),
    ).toHaveLength(2)
    expect(scripts.at(-1)?.trim()).toBe("npm publish . --provenance --access public")
    for (const forbidden of [".tgz", "NPM_TOKEN", "NODE_AUTH_TOKEN", "_authToken", ".npmrc"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
