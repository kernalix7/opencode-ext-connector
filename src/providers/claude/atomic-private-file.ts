import { randomUUID } from "node:crypto"
import type { FileHandle } from "node:fs/promises"
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

export class ClaudeCredentialSymlinkError extends Error {
  public override readonly name = "ClaudeCredentialSymlinkError"
  public constructor(public readonly path: string) {
    super(`refusing symbolic link at ${path}`)
  }
}
export class ClaudeCredentialCleanupError extends Error {
  public override readonly name = "ClaudeCredentialCleanupError"
  public constructor(
    public readonly path: string,
    public readonly primaryFailure: unknown,
    public readonly cleanupFailures: readonly unknown[],
  ) {
    super(`credential write and cleanup failed for ${path}`, { cause: primaryFailure })
  }
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && Reflect.get(error, "code") === "ENOENT"
}
async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new ClaudeCredentialSymlinkError(path)
  } catch (error: unknown) {
    if (!isMissing(error)) throw error
  }
}
export async function writeClaudePrivateFile(path: string, body: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await rejectSymlink(path)
  const candidate = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  let handle: FileHandle | null = null
  let temporary = false
  try {
    handle = await open(candidate, "wx", 0o600)
    temporary = true
    await handle.writeFile(body, "utf8")
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = null
    await rejectSymlink(path)
    await rename(candidate, path)
    temporary = false
  } catch (primaryFailure: unknown) {
    const cleanupFailures: unknown[] = []
    if (handle !== null) {
      try {
        await handle.close()
      } catch (error: unknown) {
        cleanupFailures.push(error)
      }
    }
    if (temporary) {
      try {
        await unlink(candidate)
      } catch (error: unknown) {
        if (!isMissing(error)) cleanupFailures.push(error)
      }
    }
    if (cleanupFailures.length > 0)
      throw new ClaudeCredentialCleanupError(path, primaryFailure, cleanupFailures)
    throw primaryFailure
  }
}
