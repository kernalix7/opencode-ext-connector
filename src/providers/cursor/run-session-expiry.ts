import type { CursorRunSessionIdentity } from "./run-session"

export type CursorRunSessionBackgroundCleanupErrorHandler = (
  error: CursorRunSessionTtlCleanupError,
) => void | Promise<void>

export class CursorRunSessionTtlCleanupError extends Error {
  public override readonly name = "CursorRunSessionTtlCleanupError"
  public readonly code = "CURSOR_RUN_SESSION_TTL_CLEANUP_ERROR"
  public readonly operation = "ttl-expiration"

  public constructor(
    public readonly identity: CursorRunSessionIdentity,
    public override readonly cause: AggregateError,
  ) {
    super("Cursor Run session TTL cleanup failed", { cause })
  }
}

export function settleCursorRunSessionExpiry(options: {
  readonly identity: CursorRunSessionIdentity
  readonly terminate: (identity: CursorRunSessionIdentity) => Promise<void>
  readonly onBackgroundCleanupError: CursorRunSessionBackgroundCleanupErrorHandler
}): void {
  const reported = options.terminate(options.identity).catch((cause: unknown) => {
    const aggregateCause =
      cause instanceof AggregateError
        ? cause
        : new AggregateError([cause], "Cursor Run session TTL cleanup failed")
    return options.onBackgroundCleanupError(
      new CursorRunSessionTtlCleanupError(options.identity, aggregateCause),
    )
  })
  void Promise.allSettled([reported])
}
