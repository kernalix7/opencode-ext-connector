import { randomUUID } from "node:crypto"
import type { FileHandle } from "node:fs/promises"
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

export class ClaudeCredentialSymlinkError extends Error {
  public override readonly name = "ClaudeCredentialSymlinkError"

  public constructor(public readonly path: string) {
    super(`refusing to replace symbolic link at ${path}`)
  }
}

export class ClaudeCredentialCleanupError extends Error {
  public override readonly name = "ClaudeCredentialCleanupError"

  public constructor(
    public readonly path: string,
    public readonly primaryFailure: unknown,
    public readonly cleanupFailures: readonly unknown[],
  ) {
    super(`credential write failed and temporary-file cleanup also failed for ${path}`, {
      cause: primaryFailure,
    })
  }
}

class CleanupRejectionError extends Error {
  public override readonly name = "CleanupRejectionError"

  public constructor(public readonly rejection: unknown) {
    super("temporary-file cleanup rejected with a non-Error value", { cause: rejection })
  }
}

function errorCode(error: Error): unknown {
  return "code" in error ? Reflect.get(error, "code") : undefined
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    const destination = await lstat(path)
    if (destination.isSymbolicLink()) {
      throw new ClaudeCredentialSymlinkError(path)
    }
  } catch (error: unknown) {
    if (error instanceof Error && errorCode(error) === "ENOENT") {
      return
    }
    throw error
  }
}

export async function writeClaudePrivateFile(path: string, body: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  await rejectSymbolicLink(path)

  const candidate = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  let temporaryPath: string | null = null
  let handle: FileHandle | null = null
  try {
    handle = await open(candidate, "wx", 0o600)
    temporaryPath = candidate
    await handle.writeFile(body, { encoding: "utf8" })
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(candidate, path)
    temporaryPath = null
  } catch (primaryFailure: unknown) {
    const cleanupFailures: unknown[] = []
    if (handle !== null) {
      try {
        await handle.close()
      } catch (error: unknown) {
        cleanupFailures.push(error instanceof Error ? error : new CleanupRejectionError(error))
      }
    }
    if (temporaryPath !== null) {
      try {
        await unlink(temporaryPath)
      } catch (error: unknown) {
        if (!(error instanceof Error && errorCode(error) === "ENOENT")) {
          cleanupFailures.push(error)
        }
      }
    }
    if (cleanupFailures.length > 0) {
      throw new ClaudeCredentialCleanupError(path, primaryFailure, cleanupFailures)
    }
    throw primaryFailure
  }
}
