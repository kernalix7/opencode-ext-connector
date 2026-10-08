import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []
const script = new URL("../../../scripts/check-release-payload.ts", import.meta.url).pathname
const mtime = "1985-10-26 08:15:00"
const payload = "reviewed payload\n"
const packageJson = '{"name":"opencode-ext-connector","version":"0.9.1"}'
const hash = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-payload-"))
  roots.push(root)
  await mkdir(join(root, "package"))
  await writeFile(join(root, "package/package.json"), packageJson, { mode: 0o644 })
  await writeFile(join(root, "package/payload.js"), payload, { mode: 0o644 })
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      name: "opencode-ext-connector",
      version: "0.9.1",
      originalTarballSha256: "0".repeat(64),
      ignoredContainerMetadata: ["member order", "numeric ownership", "gzip header mtime"],
      members: [
        { path: "package/package.json", content: packageJson },
        { path: "package/payload.js", content: payload },
      ].map(({ path, content }) => ({
        path,
        type: "file",
        mode: "-rw-r--r--",
        mtime,
        bytes: Buffer.byteLength(content),
        sha256: hash(content),
      })),
    }),
  )
  return root
}

function pack(root: string, members: readonly string[], options: readonly string[] = []): void {
  const result = Bun.spawnSync(
    [
      "tar",
      "--format=ustar",
      "--no-recursion",
      `--mtime=${mtime} UTC`,
      "-czf",
      "payload.tgz",
      ...options,
      "--",
      ...members,
    ],
    { cwd: root, env: { PATH: process.env["PATH"], LC_ALL: "C", TZ: "UTC" } },
  )
  expect(result.exitCode).toBe(0)
}

function check(root: string): {
  readonly exitCode: number
  readonly stdout: Buffer
  readonly stderr: Buffer
} {
  return Bun.spawnSync([process.execPath, script, "payload.tgz", "manifest.json"], {
    cwd: root,
    env: { PATH: process.env["PATH"], HOME: root, XDG_CONFIG_HOME: root },
  })
}

describe("release payload guard", () => {
  for (const mutation of [
    "content",
    "extra",
    "missing",
    "duplicate",
    "unsafe",
    "version",
    "link",
    "mode",
    "type",
  ] as const) {
    it(`rejects the archive when ${mutation} differs`, async () => {
      // Given
      const root = await fixture()
      const members = ["package/package.json", "package/payload.js"]
      const options: string[] = []
      switch (mutation) {
        case "content":
          await writeFile(join(root, "package/payload.js"), "changed payload\n")
          break
        case "extra":
          await writeFile(join(root, "package/extra.js"), "extra")
          members.push("package/extra.js")
          break
        case "missing":
          members.pop()
          break
        case "duplicate":
          members.push("package/payload.js")
          break
        case "unsafe":
          options.push("--transform=s|package/payload.js|package/../payload.js|")
          break
        case "version":
          await writeFile(join(root, "package/package.json"), packageJson.replace("0.9.1", "0.9.2"))
          break
        case "link":
          await rm(join(root, "package/payload.js"))
          await symlink("package.json", join(root, "package/payload.js"))
          break
        case "mode":
          await chmod(join(root, "package/payload.js"), 0o755)
          break
        case "type":
          await rm(join(root, "package/payload.js"))
          await mkdir(join(root, "package/payload.js"))
          break
        default:
          mutation satisfies never
      }
      pack(root, members, options)
      // When
      const result = check(root)
      // Then
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain("ReleasePayloadError")
    })
  }

  it("accepts identical payloads with different permitted container metadata", async () => {
    // Given
    const root = await fixture()
    pack(root, ["package/payload.js", "package/package.json"], ["--owner=123", "--group=456"])
    const bytes = new Uint8Array(await Bun.file(join(root, "payload.tgz")).arrayBuffer())
    bytes.set([1, 2, 3, 4], 4)
    await writeFile(join(root, "payload.tgz"), bytes)
    // When
    const result = check(root)
    // Then
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("PASS")
  })

  it("rejects concatenated archives hiding additional members after end markers", async () => {
    // Given
    const root = await fixture()
    pack(root, ["package/package.json", "package/payload.js"])
    const bytes = await Bun.file(join(root, "payload.tgz")).arrayBuffer()
    await writeFile(
      join(root, "payload.tgz"),
      Buffer.concat([Buffer.from(bytes), Buffer.from(bytes)]),
    )
    // When
    const result = check(root)
    // Then
    expect(result.exitCode).not.toBe(0)
  })
})
