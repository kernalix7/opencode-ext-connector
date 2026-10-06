import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import { z } from "zod"

const ProbeResultSchema = z.object({
  creationEvents: z.array(z.string()),
  disposalEvents: z.array(z.string()),
  samePromise: z.boolean(),
  cursorHasAuth: z.boolean(),
  xaiHasAuth: z.boolean(),
  propagated: z.boolean(),
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
  it("keeps retired hooks inert and forwards idempotent owner cleanup and failures", async () => {
    // Given / When
    const result = await runProbe()

    // Then
    expect(result).toEqual({
      creationEvents: ["hooks", "hooks"],
      disposalEvents: ["hooks", "hooks"],
      samePromise: true,
      cursorHasAuth: false,
      xaiHasAuth: false,
      propagated: true,
    })
  })
})
