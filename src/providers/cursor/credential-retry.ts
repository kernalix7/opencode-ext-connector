import { CursorDirectStreamError } from "./direct-stream.js"
import type { CursorReplayState } from "./recovery.js"

export function isCursorCredentialRetryEligible(input: {
  readonly error: unknown
  readonly replay: CursorReplayState
  readonly retryUsed: boolean
}): boolean {
  return (
    !input.retryUsed &&
    input.error instanceof CursorDirectStreamError &&
    input.error.bridgeCode === "http-401" &&
    input.replay.outputEpoch === 0 &&
    input.replay.checkpointEpoch === null &&
    !input.replay.toolBoundary
  )
}

export type CursorCredentialRetry = {
  readonly currentToken: () => string
  readonly reload: (
    error: unknown,
    replay: CursorReplayState,
    signal: AbortSignal,
  ) => Promise<boolean>
}

export function createCursorCredentialRetry(options: {
  readonly initialToken: string
  readonly reloadAccessToken: (signal: AbortSignal) => Promise<string | null>
}): CursorCredentialRetry {
  let currentToken = options.initialToken
  let retryUsed = false
  return {
    currentToken: () => currentToken,
    reload: async (error, replay, signal) => {
      if (!isCursorCredentialRetryEligible({ error, replay, retryUsed })) return false
      retryUsed = true
      const reloadedToken = await options.reloadAccessToken(signal)
      if (reloadedToken === null || reloadedToken === currentToken) return false
      currentToken = reloadedToken
      return true
    },
  }
}
