import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import { z } from "zod"

const ProbeResultSchema = z.object({
  creationEvents: z.array(z.string()),
  options: z.object({
    enabled: z.boolean(),
    leadMs: z.number(),
    retryMs: z.number(),
    envIsProcessEnv: z.boolean(),
    supervisorMatches: z.boolean(),
    hasClock: z.boolean(),
    hasLogger: z.boolean(),
  }),
  successfulDisposalEvents: z.array(z.string()),
  failedDisposalEvents: z.array(z.string()),
  primaryFailure: z.string(),
})

class ServerLifecycleProbeError extends Error {
  public override readonly name = "ServerLifecycleProbeError"
}

async function runProbe(): Promise<z.infer<typeof ProbeResultSchema>> {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "fixtures", "server-lifecycle-probe.ts")],
    {
      cwd: join(import.meta.dir, "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new ServerLifecycleProbeError(stderr)
  return ProbeResultSchema.parse(JSON.parse(stdout))
}

describe("connector server lifecycle", () => {
  it("isolates lifecycle mocks while wiring and disposing the Claude authority", async () => {
    // Given / When
    const result = await runProbe()

    // Then
    expect(result).toEqual({
      creationEvents: ["hooks", "supervisor", "authority"],
      options: {
        enabled: true,
        leadMs: 12_345,
        retryMs: 67_890,
        envIsProcessEnv: true,
        supervisorMatches: true,
        hasClock: true,
        hasLogger: true,
      },
      successfulDisposalEvents: ["authority", "supervisor", "hooks", "runtime"],
      failedDisposalEvents: ["authority", "supervisor", "hooks", "runtime"],
      primaryFailure: "authority",
    })
  })
})
