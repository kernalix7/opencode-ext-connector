import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import { runPackageCommand } from "./package-command"
import { getTestPackageRoot } from "./test-package"

const HostInspectionSchema = z
  .object({
    entrypoints: z
      .object({
        server: z.string(),
        tui: z.undefined().optional(),
        rpc: z.undefined().optional(),
      })
      .strict()
      .readonly(),
    exportTypes: z.record(z.string(), z.string()).readonly(),
  })
  .strict()
  .readonly()

// CommonJS eval avoids passing --input-type to the SDK's resolver worker.
const inspectHostProgram = `
const { join } = require("node:path")
const { pathToFileURL } = require("node:url")
const deadline = setTimeout(() => process.exit(124), 10_000)
deadline.unref()
;(async () => {
  const root = process.cwd()
  const { HostV2: Host } = await import(
    pathToFileURL(join(root, "dist", "opencode", "beta-api.js")).href
  )
  const entrypoints = Host.resolve({ directory: root, name: "opencode-ext-connector" })
  const loaded = await Host.load(entrypoints.server)
  const exportTypes = Object.fromEntries(
    Object.entries(loaded).map(([name, value]) => [name, typeof value])
  )
  process.stdout.write(JSON.stringify({ entrypoints, exportTypes }))
  clearTimeout(deadline)
})()
`

export async function inspectPackageHost(): Promise<z.infer<typeof HostInspectionSchema>> {
  const isolation = await mkdtemp(join(tmpdir(), "opencode-package-host-"))
  try {
    const home = join(isolation, "home")
    await mkdir(home)
    const stdout = await runPackageCommand({
      operation: "inspect-exports",
      command: ["node", "--eval", inspectHostProgram],
      cwd: getTestPackageRoot(),
      env: {
        PATH: z.string().min(1).parse(process.env["PATH"]),
        HOME: home,
        XDG_CONFIG_HOME: join(isolation, "config"),
        XDG_CACHE_HOME: join(isolation, "cache"),
        XDG_DATA_HOME: join(isolation, "data"),
        XDG_STATE_HOME: join(isolation, "state"),
      },
    })
    const output: unknown = JSON.parse(stdout)
    return HostInspectionSchema.parse(output)
  } finally {
    await rm(isolation, { recursive: true, force: true })
  }
}
