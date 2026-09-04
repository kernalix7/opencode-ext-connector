import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import { startOpenCode } from "./opencode-process"

const pidSchema = z.coerce.number().int().positive()
const argumentsSchema = z.array(z.string())

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && Reflect.get(error, "code") === "ESRCH") {
      return false
    }
    throw error
  }
}

describe("OpenCode process support", () => {
  it("passes port zero and returns the child server URL", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-process-port-"))
    const home = join(directory, "home")
    const argumentsPath = join(directory, "child-arguments.json")
    await mkdir(home, { recursive: true })
    await writeFile(
      join(directory, "serve"),
      `
await Bun.write(${JSON.stringify(argumentsPath)}, JSON.stringify(process.argv))
const portIndex = process.argv.indexOf("--port")
const receivedPort = process.argv.at(portIndex + 1)
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(receivedPort), fetch: () => new Response("fixture") })
console.error("opencode server listening on http://127.0.0.1:" + server.port)
await new Promise(() => undefined)
`,
      "utf8",
    )
    let opencode: Awaited<ReturnType<typeof startOpenCode>> | undefined
    try {
      // When
      opencode = await startOpenCode({
        binary: process.execPath,
        cwd: directory,
        env: {
          HOME: home,
          PATH: process.env["PATH"] ?? "",
          XDG_CACHE_HOME: join(home, "cache"),
          XDG_CONFIG_HOME: join(home, "config"),
          XDG_DATA_HOME: join(home, "data"),
        },
      })

      // Then
      const args = argumentsSchema.parse(JSON.parse(await readFile(argumentsPath, "utf8")))
      const portIndex = args.indexOf("--port")
      expect(args.at(portIndex + 1)).toBe("0")
      expect(new URL(opencode.url).port).not.toBe("0")
    } finally {
      await opencode?.close()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("kills and awaits a child that never reports a startup URL", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-process-timeout-"))
    const home = join(directory, "home")
    const pidPath = join(directory, "child.pid")
    await mkdir(home, { recursive: true })
    await writeFile(
      join(directory, "serve"),
      `
await Bun.write(${JSON.stringify(pidPath)}, String(process.pid))
Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("fixture") })
await new Promise(() => undefined)
`,
      "utf8",
    )
    try {
      // When
      const started = startOpenCode({
        binary: process.execPath,
        cwd: directory,
        env: {
          HOME: home,
          PATH: process.env["PATH"] ?? "",
          XDG_CACHE_HOME: join(home, "cache"),
          XDG_CONFIG_HOME: join(home, "config"),
          XDG_DATA_HOME: join(home, "data"),
        },
        startupTimeoutMs: 1_000,
      })

      // Then
      await expect(started).rejects.toThrow("OpenCode did not report its server URL")
      const pid = pidSchema.parse(await readFile(pidPath, "utf8"))
      expect(isProcessAlive(pid)).toBe(false)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 5_000)
})
