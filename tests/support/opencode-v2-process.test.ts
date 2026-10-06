import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import { OpenCodeV2ProcessStartError, startOpenCodeV2 } from "./opencode-v2-process"
import { blockedV2HostKeys, isolatedV2Environment, openCodeV2Binary } from "./opencode-v2-session"

const argumentsSchema = z.array(z.string())
const environmentSchema = z.record(z.string(), z.string())
const pidSchema = z.coerce.number().int().positive()

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}

function childEnvironment(home: string): Readonly<Record<string, string>> {
  return isolatedV2Environment(home)
}

describe("OpenCode V2 process support", () => {
  it("passes port zero and lowercase log level without print-logs", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-v2-port-"))
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
console.log("server listening on http://127.0.0.1:" + server.port)
console.log("server password fixture-password")
await new Promise(() => undefined)
`,
      "utf8",
    )
    let server: Awaited<ReturnType<typeof startOpenCodeV2>> | undefined
    try {
      // When
      server = await startOpenCodeV2({
        binary: process.execPath,
        cwd: directory,
        env: childEnvironment(home),
      })

      // Then
      const args = argumentsSchema.parse(JSON.parse(await readFile(argumentsPath, "utf8")))
      const portIndex = args.indexOf("--port")
      expect(args.at(portIndex + 1)).toBe("0")
      expect(args).toContain("--log-level")
      expect(args.at(args.indexOf("--log-level") + 1)).toBe("error")
      expect(args).not.toContain("--print-logs")
      expect(new URL(server.url).port).not.toBe("0")
      expect(server.password).toBe("fixture-password")
      expect(server.diagnostics()).not.toContain("fixture-password")
      expect(server.diagnostics()).toContain("server password [redacted]")
    } finally {
      await server?.close()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("kills a child that never reports a startup URL and keeps its diagnostics", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-v2-timeout-"))
    const home = join(directory, "home")
    const pidPath = join(directory, "child.pid")
    await mkdir(home, { recursive: true })
    await writeFile(
      join(directory, "serve"),
      `
await Bun.write(${JSON.stringify(pidPath)}, String(process.pid))
console.error("startup-marker")
await new Promise(() => undefined)
`,
      "utf8",
    )
    try {
      // When
      const started = startOpenCodeV2({
        binary: process.execPath,
        cwd: directory,
        env: childEnvironment(home),
        startupTimeoutMs: 1_000,
      })

      // Then
      const error = await started.then(
        () => {
          throw new Error("startup should fail")
        },
        (caught: unknown) => caught,
      )
      expect(error).toBeInstanceOf(OpenCodeV2ProcessStartError)
      if (!(error instanceof OpenCodeV2ProcessStartError)) return
      expect(error.diagnostics).toContain("startup-marker")
      const pid = pidSchema.parse(await readFile(pidPath, "utf8"))
      expect(isProcessAlive(pid)).toBe(false)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 8_000)

  it("includes early-exit stderr in the startup error", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-v2-exit-"))
    const home = join(directory, "home")
    await mkdir(home, { recursive: true })
    await writeFile(
      join(directory, "serve"),
      `
console.error("early-exit-marker")
process.exit(7)
`,
      "utf8",
    )
    try {
      // When
      const started = startOpenCodeV2({
        binary: process.execPath,
        cwd: directory,
        env: childEnvironment(home),
      })

      // Then
      const error = await started.then(
        () => {
          throw new Error("startup should fail")
        },
        (caught: unknown) => caught,
      )
      expect(error).toBeInstanceOf(OpenCodeV2ProcessStartError)
      if (!(error instanceof OpenCodeV2ProcessStartError)) return
      expect(error.exitCode).toBe(7)
      expect(error.diagnostics).toContain("early-exit-marker")
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("kills a child that ignores SIGTERM within the close bound", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-v2-kill-"))
    const home = join(directory, "home")
    const pidPath = join(directory, "child.pid")
    await mkdir(home, { recursive: true })
    await writeFile(
      join(directory, "serve"),
      `
await Bun.write(${JSON.stringify(pidPath)}, String(process.pid))
process.on("SIGTERM", () => undefined)
console.log("server listening on http://127.0.0.1:9")
console.log("server password fixture-password")
await new Promise(() => undefined)
`,
      "utf8",
    )
    let server: Awaited<ReturnType<typeof startOpenCodeV2>> | undefined
    try {
      server = await startOpenCodeV2({
        binary: process.execPath,
        cwd: directory,
        env: childEnvironment(home),
        closeTimeoutMs: 200,
      })
      const pid = pidSchema.parse(await readFile(pidPath, "utf8"))

      // When
      const firstClose = server.close()
      expect(server.close()).toBe(firstClose)
      await firstClose

      // Then
      expect(isProcessAlive(pid)).toBe(false)
      expect(server.exitCode).toBe(await server.exited)
    } finally {
      await server?.close()
      await rm(directory, { force: true, recursive: true })
    }
  }, 8_000)

  it("gives the child only the isolated home and no host tokens", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "opencode-v2-env-"))
    const home = join(directory, "home")
    const envPath = join(directory, "child-env.json")
    await mkdir(home, { recursive: true })
    await writeFile(
      join(directory, "serve"),
      `
await Bun.write(${JSON.stringify(envPath)}, JSON.stringify(process.env))
console.log("server listening on http://127.0.0.1:9")
console.log("server password fixture-password")
await new Promise(() => undefined)
`,
      "utf8",
    )
    const env = childEnvironment(home)
    let server: Awaited<ReturnType<typeof startOpenCodeV2>> | undefined
    try {
      // When
      server = await startOpenCodeV2({ binary: process.execPath, cwd: directory, env })

      // Then
      const childEnv = environmentSchema.parse(JSON.parse(await readFile(envPath, "utf8")))
      expect(childEnv["HOME"]).toBe(home)
      expect(childEnv["XDG_CACHE_HOME"]).toBe(join(home, "cache"))
      expect(childEnv["XDG_CONFIG_HOME"]).toBe(join(home, "config"))
      expect(childEnv["XDG_DATA_HOME"]).toBe(join(home, "data"))
      expect(childEnv["OPENCODE_DISABLE_MODELS_FETCH"]).toBe("1")
      for (const key of blockedV2HostKeys()) expect(childEnv[key]).toBeUndefined()
      expect(openCodeV2Binary({ OPENCODE_V2_BIN: "/tmp/injected-opencode2" })).toBe(
        "/tmp/injected-opencode2",
      )
    } finally {
      await server?.close()
      await rm(directory, { force: true, recursive: true })
    }
  })
})
