import { describe, expect, it } from "bun:test"

import { z } from "zod"

const stepSchema = z
  .object({
    "continue-on-error": z.boolean().optional(),
    name: z.string().optional(),
    run: z.string().optional(),
    uses: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()

const jobSchema = z
  .object({
    "continue-on-error": z.boolean().optional(),
    "runs-on": z.string(),
    steps: z.array(stepSchema),
  })
  .loose()

const workflowSchema = z.object({
  jobs: z.object({ check: jobSchema }),
  permissions: z.record(z.string(), z.string()),
})

const workflowPath = new URL("../../../.github/workflows/ci.yml", import.meta.url)

async function readWorkflow(): Promise<z.infer<typeof workflowSchema>> {
  const source = await Bun.file(workflowPath).text()
  return workflowSchema.parse(Bun.YAML.parse(source))
}

describe("CI workflow", () => {
  it("installs the validated OpenCode package without the live installer", async () => {
    // Given
    const workflow = await readWorkflow()

    // When
    const install = workflow.jobs.check.steps.find((step) => step.name === "Install OpenCode CLI")
    const verify = workflow.jobs.check.steps.find((step) => step.name === "Verify OpenCode CLI")

    // Then
    expect(install?.run?.trim()).toBe("npm install -g opencode-ai@1.18.27")
    expect(verify?.run?.trim()).toBe("opencode --version")
    expect(JSON.stringify(workflow)).not.toContain("curl")
  })

  it("pins CI actions and runtime versions", async () => {
    // Given
    const workflow = await readWorkflow()

    // When
    const actionSteps = workflow.jobs.check.steps.filter((step) => step.uses !== undefined)

    // Then
    expect(actionSteps.map((step) => step.uses)).toEqual([
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    ])
    expect(actionSteps.at(1)?.with).toEqual({ "bun-version": "1.3.14" })
    expect(actionSteps.at(2)?.with).toEqual({ "node-version": "24.20.0" })
  })

  it("keeps all project checks ordered and fail-fast", async () => {
    // Given
    const workflow = await readWorkflow()

    // When
    const { check } = workflow.jobs
    const projectCommands = check.steps
      .flatMap((step) => (step.run === undefined ? [] : [step.run.trim()]))
      .slice(-8)

    // Then
    expect(projectCommands).toEqual([
      "bun install --frozen-lockfile",
      "bun run check",
      "bun run build",
      "bun test",
      "bun run test:provider",
      "bun run test:integration",
      "bun run test:e2e",
      "bun run verify:package",
    ])
    expect(workflow.permissions).toEqual({ contents: "read" })
    expect(check["runs-on"]).toBe("ubuntu-latest")
    expect(check["continue-on-error"]).not.toBe(true)
    expect(check.steps.every((step) => step["continue-on-error"] !== true)).toBe(true)
  })
})
