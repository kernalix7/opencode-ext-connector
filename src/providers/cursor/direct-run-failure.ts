import type { CursorDirectSetupCleanup } from "./direct-run-types.js"
import type { CursorRunSession } from "./run-session.js"
import type { CursorStreamAdapter } from "./stream-adapter.js"

export async function retireCursorSessionForRetry(
  session: CursorRunSession,
  cause: unknown,
): Promise<void> {
  try {
    const retireForRetry = session.retireForRetry
    if (retireForRetry === undefined) throw new TypeError("retry retirement is unavailable")
    await retireForRetry()
  } catch (retirementError) {
    throw new AggregateError([cause, retirementError], "Cursor retry retirement failed")
  }
}

export async function failCursorDirectRun(
  logical: {
    readonly adapter: CursorStreamAdapter
    readonly cleanup: CursorDirectSetupCleanup
  },
  session: CursorRunSession | null,
  error: unknown,
): Promise<void> {
  try {
    if (session === null) {
      logical.cleanup.invalidateCheckpoint()
      logical.cleanup.invalidateSession()
    } else await session.abort()
  } catch (cleanupError) {
    logical.adapter.fail(
      new AggregateError([error, cleanupError], "Cursor recovery cleanup failed"),
    )
    return
  }
  logical.adapter.fail(error)
}
