import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import { z } from "zod"

const ProbeResultSchema = z.object({
  standaloneCreationEvents: z.array(z.string()),
  creationEvents: z.array(z.string()),
  claudeOptions: z.object({
    enabled: z.boolean(),
    leadMs: z.number(),
    retryMs: z.number(),
    envIsProcessEnv: z.boolean(),
    supervisorMatches: z.boolean(),
    hasClock: z.boolean(),
    hasLogger: z.boolean(),
  }),
  xaiOptions: z.object({
    enabled: z.boolean(),
    envIsProcessEnv: z.boolean(),
    supervisorMatches: z.boolean(),
  }),
  successfulDisposalEvents: z.array(z.string()),
  standaloneEvents: z.array(z.string()),
  standaloneAuthorityHasAuth: z.boolean(),
  standaloneConsumerMethods: z.number(),
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
  it("wires Claude and xAI authorities and preserves the Claude failure when all disposals fail", async () => {
    // Given / When
    const result = await runProbe()

    // Then
    expect(result).toEqual({
      standaloneCreationEvents: [],
      creationEvents: ["hooks", "supervisor", "claude-authority", "xai-authority"],
      claudeOptions: {
        enabled: true,
        leadMs: 12_345,
        retryMs: 67_890,
        envIsProcessEnv: true,
        supervisorMatches: true,
        hasClock: true,
        hasLogger: true,
      },
      xaiOptions: {
        enabled: true,
        envIsProcessEnv: true,
        supervisorMatches: true,
      },
      successfulDisposalEvents: [
        "claude-authority",
        "xai-authority",
        "supervisor",
        "hooks",
        "runtime",
      ],
      standaloneEvents: [],
      standaloneAuthorityHasAuth: false,
      standaloneConsumerMethods: 0,
      failedDisposalEvents: ["claude-authority", "xai-authority", "supervisor", "hooks", "runtime"],
      primaryFailure: "claude-authority",
    })
  })
})
