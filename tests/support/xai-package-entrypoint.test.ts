import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { z } from "zod"

import { packCleanSource } from "./packed-package"

const projectRoot = join(import.meta.dir, "..", "..")
const InspectionSchema = z.object({
  names: z.array(z.string()),
  kinds: z.array(z.string()),
  consumer: z.object({
    provider: z.string(),
    loaderKind: z.string(),
    methods: z.array(z.unknown()),
  }),
})

describe("packaged xAI entrypoint", () => {
  it("exports only the xAI server and returns consumer auth hooks", async () => {
    // Given
    const directory = await mkdtemp(join(projectRoot, ".xai-package-"))
    const packageDirectory = join(directory, "package")
    let packed: Awaited<ReturnType<typeof packCleanSource>> | undefined
    try {
      packed = await packCleanSource({ projectRoot })
      await mkdir(packageDirectory)
      const extract = Bun.spawn(
        ["tar", "-xzf", packed.tarballPath, "--strip-components=1", "-C", packageDirectory],
        { stderr: "pipe", stdout: "pipe" },
      )
      const extractExitCode = await extract.exited
      expect(extractExitCode).toBe(0)

      // When
      const inspect = Bun.spawn(
        [
          process.env["NODE_BIN"] ?? "node",
          "--input-type=module",
          "--eval",
          `
            const xai = await import(${JSON.stringify(pathToFileURL(join(packageDirectory, "dist", "xai.js")).href)});
            const names = Object.keys(xai);
            const kinds = Object.values(xai).map((value) => typeof value);
            const hooks = await xai.xaiAuthServer({}, { xaiOAuth: { mode: 'consumer' } });
            const consumer = { provider: hooks.auth?.provider, loaderKind: typeof hooks.auth?.loader, methods: hooks.auth?.methods };
            process.stdout.write(JSON.stringify({ names, kinds, consumer }));
          `,
        ],
        { cwd: projectRoot, stderr: "pipe", stdout: "pipe" },
      )
      const [inspectExitCode, stdout] = await Promise.all([
        inspect.exited,
        new Response(inspect.stdout).text(),
      ])

      // Then
      expect(inspectExitCode).toBe(0)
      expect(InspectionSchema.parse(JSON.parse(stdout))).toEqual({
        names: ["xaiAuthServer"],
        kinds: ["function"],
        consumer: { provider: "xai", loaderKind: "function", methods: [] },
      })
    } finally {
      await packed?.cleanup()
      await rm(directory, { force: true, recursive: true })
    }
  }, 20_000)
})
