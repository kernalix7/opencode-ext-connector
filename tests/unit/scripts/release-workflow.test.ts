import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

const actionShas = {
  checkout: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  downloadArtifact: "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
  setupBun: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
  setupNode: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  uploadArtifact: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
} as const

const stepSchema = z
  .object({
    "continue-on-error": z.boolean().optional(),
    id: z.string().optional(),
    run: z.string().optional(),
    uses: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()

const jobSchema = z
  .object({
    "continue-on-error": z.boolean().optional(),
    "runs-on": z.string(),
    if: z.string().optional(),
    needs: z.string().optional(),
    permissions: z.record(z.string(), z.string()),
    steps: z.array(stepSchema),
    strategy: z.unknown().optional(),
  })
  .loose()

const workflowSchema = z.object({
  jobs: z.object({ publish: jobSchema, "recover-v0-3-3": z.unknown(), verify: jobSchema }).strict(),
  on: z.object({
    push: z.object({ tags: z.tuple([z.literal("v*")]) }),
    workflow_dispatch: z.object({}).strict(),
  }),
  permissions: z.record(z.string(), z.string()),
})

type Job = z.infer<typeof jobSchema>

const workflowPath = new URL("../../../.github/workflows/release.yml", import.meta.url)

async function readWorkflow(): Promise<z.infer<typeof workflowSchema>> {
  const source = await Bun.file(workflowPath).text()
  return workflowSchema.parse(Bun.YAML.parse(source))
}

function actionUses(job: Job): readonly string[] {
  return job.steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]))
}

function runScripts(job: Job): readonly string[] {
  return job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run]))
}

describe("release workflow", () => {
  it("restricts the release trigger and OIDC permission to the publish job", async () => {
    // Given
    const workflow = await readWorkflow()

    // When
    const { publish, verify } = workflow.jobs

    // Then
    expect(workflow.on).toEqual({ push: { tags: ["v*"] }, workflow_dispatch: {} })
    expect(workflow.permissions).toEqual({ contents: "read" })
    expect(verify.permissions).toEqual({ contents: "read" })
    expect(publish.permissions).toEqual({ "id-token": "write" })
    expect(publish.needs).toBe("verify")
    for (const job of [verify, publish]) {
      expect(job["runs-on"]).toBe("ubuntu-latest")
      expect(job.strategy).toBeUndefined()
      expect(job.if).toBe("github.event_name == 'push'")
      expect(job["continue-on-error"]).not.toBe(true)
      expect(job.steps.every((step) => step["continue-on-error"] !== true)).toBe(true)
    }
  })

  it("pins every release action and executable tool version", async () => {
    // Given
    const workflow = await readWorkflow()

    // When
    const verifyRuns = runScripts(workflow.jobs.verify)
    const publishRuns = runScripts(workflow.jobs.publish)

    // Then
    expect(actionUses(workflow.jobs.verify)).toEqual([
      actionShas.checkout,
      actionShas.setupBun,
      actionShas.setupNode,
      actionShas.uploadArtifact,
    ])
    expect(actionUses(workflow.jobs.publish)).toEqual([
      actionShas.downloadArtifact,
      actionShas.setupNode,
    ])
    expect(workflow.jobs.verify.steps.at(1)?.with).toEqual({ "bun-version": "1.3.14" })
    expect(workflow.jobs.verify.steps.at(2)?.with).toEqual({ "node-version": "24.20.0" })
    expect(workflow.jobs.publish.steps.at(2)?.with).toEqual({ "node-version": "24.20.0" })
    expect(verifyRuns.some((run) => run.includes("npm install -g npm@11.10.0"))).toBe(true)
    expect(verifyRuns.some((run) => run.includes("npm install -g opencode-ai@1.18.27"))).toBe(true)
    expect(publishRuns.some((run) => run.includes("npm install -g npm@11.10.0"))).toBe(true)
    const workflowValues = JSON.stringify(workflow)
    for (const forbidden of [
      "curl",
      "wget",
      "NPM_TOKEN",
      "NODE_AUTH_TOKEN",
      "_authToken",
      ".npmrc",
      "npm config set",
      "registry-url",
      "always-auth",
    ]) {
      expect(workflowValues).not.toContain(forbidden)
    }
  })

  it("packs and uploads one checksummed tarball after verification", async () => {
    // Given
    const workflow = await readWorkflow()

    // When
    const scripts = runScripts(workflow.jobs.verify)
    const commands = [
      "bun install --frozen-lockfile",
      "bun run check",
      "bun run build",
      "bun test",
      "bun run test:e2e",
      "bun pm pack --destination release --quiet",
      "sha256sum",
    ] as const
    const positions = commands.map((command) => scripts.findIndex((run) => run.includes(command)))
    const upload = workflow.jobs.verify.steps.find(
      (step) => step.uses === actionShas.uploadArtifact,
    )

    // Then
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(scripts.filter((run) => run.includes("bun pm pack")).length).toBe(1)
    expect(scripts.every((run) => !run.includes("--dry-run"))).toBe(true)
    expect(JSON.stringify(workflow.jobs.verify)).not.toContain("bun run verify:package")
    expect(upload?.with).toEqual({
      "if-no-files-found": "error",
      name: "npm-package",
      path: "release/*.tgz\nrelease/*.tgz.sha256\n",
    })
  })

  it("publishes only the verified artifact from the dependent OIDC job", async () => {
    // Given
    const workflow = await readWorkflow()

    // When
    const { publish } = workflow.jobs
    const runs = runScripts(publish)
    const artifact = publish.steps.find((step) => step.id === "artifact")
    const versionExpression = "$" + "{version}"
    const tarballOutput = "$" + "{{ steps.artifact.outputs.tarball }}"

    // Then
    expect(publish.steps.at(0)?.uses).toBe(actionShas.downloadArtifact)
    expect(publish.steps.at(0)?.with).toEqual({ name: "npm-package", path: "release" })
    expect(artifact?.run).toContain('sha256sum --check "$checksum"')
    expect(artifact?.run).toContain('tar -xOf "$tarball" package/package.json')
    expect(artifact?.run).toContain(`"$GITHUB_REF_NAME" != "v${versionExpression}"`)
    expect(artifact?.run).toContain('echo "tarball=$tarball" >> "$GITHUB_OUTPUT"')
    expect(runs.at(-1)?.trim()).toBe(
      `npm publish "./${tarballOutput}" --provenance --access public`,
    )
    const publishValues = JSON.stringify(publish)
    for (const forbidden of ["actions/checkout", "git ", "bun ", "opencode ", "npm install --"]) {
      expect(publishValues).not.toContain(forbidden)
    }
  })

  it("verifies the downloaded artifact layout before publishing", async () => {
    // Given
    const workflow = await readWorkflow()
    const artifactScript = z
      .string()
      .parse(workflow.jobs.publish.steps.find((step) => step.id === "artifact")?.run)
    const directory = await mkdtemp(join(tmpdir(), "release-workflow-"))
    const releaseDirectory = join(directory, "release")
    const outputPath = join(directory, "github-output")
    try {
      await mkdir(join(directory, "package"), { recursive: true })
      await mkdir(releaseDirectory)
      await writeFile(join(directory, "package", "package.json"), '{"version":"0.3.3"}', "utf8")
      const archive = Bun.spawnSync(
        ["tar", "-czf", "release/opencode-ext-connector-0.3.3.tgz", "package"],
        { cwd: directory },
      )
      expect(archive.exitCode).toBe(0)
      const checksum = Bun.spawnSync(["sha256sum", "release/opencode-ext-connector-0.3.3.tgz"], {
        cwd: directory,
      })
      expect(checksum.exitCode).toBe(0)
      await writeFile(
        join(releaseDirectory, "opencode-ext-connector-0.3.3.tgz.sha256"),
        checksum.stdout,
      )

      // When
      const verification = Bun.spawnSync(["bash", "-c", artifactScript], {
        cwd: directory,
        env: {
          GITHUB_OUTPUT: outputPath,
          GITHUB_REF_NAME: "v0.3.3",
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        },
      })

      // Then
      expect(verification.exitCode).toBe(0)
      expect(await Bun.file(outputPath).text()).toBe(
        "tarball=release/opencode-ext-connector-0.3.3.tgz\n",
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
