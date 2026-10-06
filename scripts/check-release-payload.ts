import { createHash } from "node:crypto"
import { resolve } from "node:path"

import { z } from "zod"

const pathSchema = z
  .string()
  .regex(/^package\/[A-Za-z0-9._/-]+$/)
  .refine((path) => path.split("/").every((part) => part !== "" && part !== "." && part !== ".."))
  .brand("ReleaseMemberPath")
const memberSchema = z
  .object({
    path: pathSchema,
    type: z.literal("file"),
    mode: z.string().regex(/^-[rwx-]{9}$/),
    mtime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(32 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .readonly()
const manifestSchema = z
  .object({
    name: z.literal("opencode-ext-connector"),
    version: z.literal("0.8.0"),
    originalTarballSha256: z.string().regex(/^[a-f0-9]{64}$/),
    ignoredContainerMetadata: z
      .tuple([
        z.literal("member order"),
        z.literal("numeric ownership"),
        z.literal("gzip header mtime"),
      ])
      .readonly(),
    members: z.array(memberSchema).min(1).readonly(),
  })
  .strict()
  .readonly()
const packageSchema = z.object({ name: z.string(), version: z.string() })
type MemberPath = z.infer<typeof pathSchema>

export class ReleasePayloadError extends Error {
  public override readonly name = "ReleasePayloadError"

  public constructor(
    public readonly reason: string,
    public readonly member = "",
  ) {
    super(`Release payload rejected: ${reason}${member === "" ? "" : ` (${member})`}`)
  }
}

function tar(args: readonly string[]): Buffer {
  const result = Bun.spawnSync(["tar", ...args], {
    env: { PATH: process.env["PATH"], LC_ALL: "C", TZ: "UTC" },
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.exitCode !== 0 || result.stderr.length > 0) {
    throw new ReleasePayloadError("tar inspection failed", result.stderr.toString())
  }
  return result.stdout
}

function memberBytes(archive: string, path: MemberPath): Buffer {
  return tar([
    "--extract",
    "--to-stdout",
    "--occurrence=1",
    "--no-wildcards",
    "-zf",
    archive,
    "--",
    path,
  ])
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source)
  } catch (error) {
    if (error instanceof SyntaxError) throw new ReleasePayloadError("invalid JSON")
    throw error
  }
}

export async function checkReleasePayload(
  archivePath: string,
  manifestPath = new URL("../release-manifests/0.8.0.json", import.meta.url).pathname,
): Promise<number> {
  const parsed = manifestSchema.safeParse(parseJson(await Bun.file(manifestPath).text()))
  if (!parsed.success) throw new ReleasePayloadError("invalid manifest")
  const manifest = parsed.data
  const expected = new Map(manifest.members.map((member) => [member.path, member]))
  if (expected.size !== manifest.members.length)
    throw new ReleasePayloadError("duplicate manifest path")
  const archive = resolve(archivePath)
  const listing = tar([
    "--list",
    "--verbose",
    "--numeric-owner",
    "--full-time",
    "--quoting-style=escape",
    "--ignore-zeros",
    "-zf",
    archive,
  ]).toString()
  const seen = new Set<MemberPath>()
  for (const line of listing.trimEnd().split("\n")) {
    const match =
      /^(-[rwx-]{9})\s+\d+\/\d+\s+(\d+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(.+)$/.exec(line)
    if (match === null) throw new ReleasePayloadError("non-regular member or invalid listing", line)
    const pathResult = pathSchema.safeParse(match.at(4))
    if (!pathResult.success) throw new ReleasePayloadError("unsafe path", line)
    const path = pathResult.data
    if (seen.has(path)) throw new ReleasePayloadError("duplicate member", path)
    seen.add(path)
    const member = expected.get(path)
    if (member === undefined) throw new ReleasePayloadError("extra member", path)
    if (match.at(1) !== member.mode) throw new ReleasePayloadError("mode mismatch", path)
    if (match.at(3) !== member.mtime) throw new ReleasePayloadError("mtime mismatch", path)
    if (Number(match.at(2)) !== member.bytes) throw new ReleasePayloadError("size mismatch", path)
  }
  if (seen.size !== expected.size) throw new ReleasePayloadError("missing member")
  const packagePath = pathSchema.parse("package/package.json")
  if (!seen.has(packagePath)) throw new ReleasePayloadError("missing package manifest")
  const metadata = packageSchema.safeParse(parseJson(memberBytes(archive, packagePath).toString()))
  if (
    !metadata.success ||
    metadata.data.name !== manifest.name ||
    metadata.data.version !== manifest.version
  ) {
    throw new ReleasePayloadError("package name or version mismatch")
  }
  for (const member of manifest.members) {
    const bytes = memberBytes(archive, member.path)
    if (
      bytes.length !== member.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== member.sha256
    ) {
      throw new ReleasePayloadError("content mismatch", member.path)
    }
  }
  return seen.size
}

if (import.meta.main) {
  const args = z
    .tuple([z.string().min(1), z.string().min(1).optional()])
    .safeParse(process.argv.slice(2))
  if (!args.success)
    throw new ReleasePayloadError(
      "usage: bun scripts/check-release-payload.ts archive.tgz [manifest.json]",
    )
  const count = await checkReleasePayload(args.data[0], args.data[1])
  process.stdout.write(`PASS: ${count} reviewed release payloads unchanged\n`)
}
