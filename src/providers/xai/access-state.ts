import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import { z } from "zod"

const XaiAccessRecordSchema = z.discriminatedUnion("state", [
  z
    .object({
      schema_version: z.literal(1),
      provider: z.literal("xai"),
      state: z.literal("ready"),
      access: z.string().min(1),
      expires: z.number().int().nonnegative(),
    })
    .strict()
    .readonly(),
  z
    .object({
      schema_version: z.literal(1),
      provider: z.literal("xai"),
      state: z.literal("unavailable"),
    })
    .strict()
    .readonly(),
])

export type XaiAccessState =
  | { readonly kind: "ready"; readonly access: string; readonly expires: number }
  | { readonly kind: "unavailable" }

export type XaiAccessFileMetadata = {
  readonly regular: boolean
  readonly links: number
  readonly mode: number
  readonly ownerUid: number
}

export interface XaiAccessFile {
  stat(): Promise<XaiAccessFileMetadata>
  readText(): Promise<string>
  close(): Promise<void>
}

export type XaiAccessStateOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly currentUid?: () => number | undefined
  readonly openFile?: (path: string) => Promise<XaiAccessFile>
}

const UnavailableState = Object.freeze({ kind: "unavailable" as const })

class XaiAccessStateInvariantError extends Error {
  public override readonly name = "XaiAccessStateInvariantError"

  public constructor() {
    super("unexpected xAI access state")
  }
}

function assertNeverAccessState(_state: never): never {
  throw new XaiAccessStateInvariantError()
}

function currentProcessUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined
}

async function openAccessFile(path: string): Promise<XaiAccessFile> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  return {
    stat: async () => {
      const metadata = await handle.stat()
      return {
        regular: metadata.isFile(),
        links: metadata.nlink,
        mode: metadata.mode & 0o7777,
        ownerUid: metadata.uid,
      }
    },
    readText: () => handle.readFile("utf8"),
    close: () => handle.close(),
  }
}

export function resolveXaiAccessPath(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const dataHome = env["XDG_DATA_HOME"]
  if (dataHome !== undefined && dataHome.length > 0) {
    return isAbsolute(dataHome) ? join(dataHome, "opencode", "xai-access.json") : null
  }
  const home = env["HOME"]
  return home !== undefined && home.length > 0 && isAbsolute(home)
    ? join(home, ".local", "share", "opencode", "xai-access.json")
    : null
}

function parsedState(raw: string): XaiAccessState {
  const parsedJson: unknown = JSON.parse(raw)
  const record = XaiAccessRecordSchema.safeParse(parsedJson)
  if (!record.success) return UnavailableState
  switch (record.data.state) {
    case "ready":
      return Object.freeze({
        kind: "ready",
        access: record.data.access,
        expires: record.data.expires,
      })
    case "unavailable":
      return UnavailableState
    default:
      return assertNeverAccessState(record.data)
  }
}

export async function readXaiAccessState(options: XaiAccessStateOptions): Promise<XaiAccessState> {
  const path = resolveXaiAccessPath(options.env)
  if (path === null) return UnavailableState
  const openFile = options.openFile ?? openAccessFile
  let file: XaiAccessFile
  try {
    file = await openFile(path)
  } catch (error: unknown) {
    if (error instanceof Error) return UnavailableState
    throw error
  }
  let state: XaiAccessState = UnavailableState
  try {
    const metadata = await file.stat()
    const runtimeUid = (options.currentUid ?? currentProcessUid)()
    const ownerMatches = runtimeUid === undefined || metadata.ownerUid === runtimeUid
    if (metadata.regular && metadata.links === 1 && metadata.mode === 0o600 && ownerMatches) {
      state = parsedState(await file.readText())
    }
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
  }
  try {
    await file.close()
  } catch (error: unknown) {
    if (error instanceof Error) return UnavailableState
    throw error
  }
  return state
}
