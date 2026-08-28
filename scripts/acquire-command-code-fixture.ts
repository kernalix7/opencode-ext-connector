import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

const VERSION = "1.32.1"
const SOURCE = "https://unpkg.com/command-code@1.32.1/dist/cli.mjs"
const FILE = "cli.mjs"
const SHA256 = "d404aa1e66d9e4adbfa0f998d328609b50cea5d78812cfe119ad2da529c08988"

const manifestSchema = z
  .object({
    version: z.literal(VERSION),
    source: z.literal(SOURCE),
    file: z.literal(FILE),
    sha256: z.literal(SHA256),
  })
  .strict()

type FixtureManifest = z.infer<typeof manifestSchema>

export const COMMAND_CODE_FIXTURE_DIRECTORY: string = join(
  import.meta.dir,
  "..",
  "tests",
  "fixtures",
  "command-code",
  VERSION,
)

export type CommandCodeFixtureDependencies = {
  readonly fixtureDirectory?: string
  readonly fetchArtifact?: (source: string) => Promise<Uint8Array>
}

class FixtureVerificationError extends Error {
  public constructor(detail: string) {
    super(`Command Code fixture verification failed: ${detail}`)
    this.name = "FixtureVerificationError"
  }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function expectedManifest(): FixtureManifest {
  return { version: VERSION, source: SOURCE, file: FILE, sha256: SHA256 }
}

async function verifyFixture(fixtureDirectory: string): Promise<void> {
  const manifestPath = join(fixtureDirectory, "manifest.json")
  const manifestText = await readFile(manifestPath, "utf8")
  let decoded: unknown
  try {
    decoded = JSON.parse(manifestText)
  } catch (error) {
    throw new FixtureVerificationError(
      `manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const parsed = manifestSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new FixtureVerificationError(`manifest drift: ${z.prettifyError(parsed.error)}`)
  }
  const bytes = await readFile(join(fixtureDirectory, parsed.data.file))
  const actual = digest(bytes)
  if (actual !== parsed.data.sha256) {
    throw new FixtureVerificationError(`sha256 expected ${parsed.data.sha256}, received ${actual}`)
  }
}

async function download(source: string): Promise<Uint8Array> {
  const response = await fetch(source)
  if (!response.ok) {
    throw new FixtureVerificationError(`refresh returned HTTP ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function refreshFixture(
  fixtureDirectory: string,
  fetchArtifact: (source: string) => Promise<Uint8Array>,
): Promise<void> {
  const bytes = await fetchArtifact(SOURCE)
  const actual = digest(bytes)
  if (actual !== SHA256) {
    throw new FixtureVerificationError(`sha256 expected ${SHA256}, received ${actual}`)
  }
  await mkdir(fixtureDirectory, { recursive: true })
  await writeFile(join(fixtureDirectory, FILE), bytes)
  await writeFile(
    join(fixtureDirectory, "manifest.json"),
    `${JSON.stringify(expectedManifest(), null, 2)}\n`,
  )
  await verifyFixture(fixtureDirectory)
}

export async function acquireCommandCodeFixture(
  args: readonly string[],
  dependencies: CommandCodeFixtureDependencies = {},
): Promise<void> {
  const fixtureDirectory = dependencies.fixtureDirectory ?? COMMAND_CODE_FIXTURE_DIRECTORY
  const mode = args.length === 0 ? "--verify" : args.at(0)
  if (args.length > 1 || (mode !== "--verify" && mode !== "--refresh")) {
    throw new FixtureVerificationError("expected --verify or --refresh")
  }
  if (mode === "--refresh") {
    await refreshFixture(fixtureDirectory, dependencies.fetchArtifact ?? download)
    return
  }
  await verifyFixture(fixtureDirectory)
}

if (import.meta.main) {
  await acquireCommandCodeFixture(process.argv.slice(2))
}
