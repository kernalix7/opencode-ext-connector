import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Clock } from "../../core/clock.js"
import { OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import type { CredentialRefreshPolicy } from "../../core/options.js"
import {
  type ClaudeAuthLookup,
  type ClaudeSourceObservation,
  readClaudeCredentialSource,
} from "./auth.js"
import { type ClaudeCredentials, claudeAccessNeedsRefresh } from "./credentials.js"
import { refreshClaudeAccessTokenResult } from "./refresh.js"

export type ClaudeCredentialLineageId = string & z.$brand<"ClaudeCredentialLineage">
const lineageSchema: z.ZodType<ClaudeCredentialLineageId> = z.custom<ClaudeCredentialLineageId>(
  (value) => z.uuid().safeParse(value).success,
)
export type ClaudeCredentialObservation = ClaudeSourceObservation & {
  readonly lineageId: ClaudeCredentialLineageId
}
export type ClaudeTokenOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly clock: Clock
  readonly transport: HttpTransport
  readonly lookup?: ClaudeAuthLookup
  readonly refresh?: CredentialRefreshPolicy
  readonly writeBackEnabled?: boolean
  readonly writeBack?: (
    credentials: ClaudeCredentials,
    previous: ClaudeSourceObservation,
  ) => Promise<void>
}
export type ClaudeTokenManager = {
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly readCredentialObservation: (
    signal: AbortSignal,
  ) => Promise<ClaudeCredentialObservation | null>
  readonly dispose: () => Promise<void>
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

export function createClaudeTokenManager(options: ClaudeTokenOptions): ClaudeTokenManager {
  const policy = options.refresh ?? { mode: "auto", leadMs: 60_000 }
  const lifetime = new AbortController()
  let current: ClaudeCredentialObservation | null = null
  let source: ClaudeSourceObservation | null = null
  let flight: Promise<string | null> | null = null
  let failures = 0
  let retryAt = 0
  let disposed = false
  let cleanup: Promise<void> | null = null
  const ensureActive = (signal: AbortSignal): void => {
    if (signal.aborted || disposed) throw new OperationCancelledError("claude-token-manager")
  }
  const observe = async (signal: AbortSignal): Promise<ClaudeCredentialObservation | null> => {
    ensureActive(signal)
    const next = await readClaudeCredentialSource(options.env, signal, options.lookup)
    ensureActive(signal)
    if (next === null) {
      source = null
      current = null
      return null
    }
    if (source?.sourceIdentity !== next.sourceIdentity || source.revision !== next.revision) {
      const owned =
        current !== null &&
        source !== null &&
        next.sourceIdentity === source.sourceIdentity &&
        next.credentials.accessToken === current.credentials.accessToken &&
        next.credentials.refreshToken === current.credentials.refreshToken &&
        next.credentials.expiresAtMs === current.credentials.expiresAtMs
      current = {
        ...next,
        lineageId:
          owned && current !== null ? current.lineageId : lineageSchema.parse(randomUUID()),
      }
      failures = 0
      retryAt = 0
    }
    source = next
    return current
  }
  const refresh = async (
    observed: ClaudeCredentialObservation,
    signal: AbortSignal,
  ): Promise<string | null> => {
    ensureActive(signal)
    if (flight !== null) return awaitFlight(flight, signal)
    if (observed.credentials.refreshToken === null || options.clock.nowMs() < retryAt) return null
    const refreshToken = observed.credentials.refreshToken
    const operation = (async (): Promise<string | null> => {
      const result = await refreshClaudeAccessTokenResult({
        transport: options.transport,
        clock: options.clock,
        refreshToken,
        signal: lifetime.signal,
      })
      ensureActive(lifetime.signal)
      const latest = await observe(lifetime.signal)
      if (
        latest?.lineageId !== observed.lineageId ||
        source?.revision !== observed.revision ||
        source.sourceIdentity !== observed.sourceIdentity
      )
        return null
      if (!result.ok) {
        if (result.kind === "transient") {
          failures += 1
          retryAt =
            options.clock.nowMs() +
            Math.min(60_000, result.retryAfterMs ?? 15_000 * 2 ** Math.min(failures - 1, 2))
        } else {
          failures = 0
          retryAt = 0
        }
        return null
      }
      if (options.writeBackEnabled === true && options.writeBack !== undefined && source !== null) {
        await options.writeBack(result.credentials, source)
        ensureActive(lifetime.signal)
        const afterWrite = await readClaudeCredentialSource(
          options.env,
          lifetime.signal,
          options.lookup,
        )
        ensureActive(lifetime.signal)
        if (
          current?.lineageId !== observed.lineageId ||
          source?.revision !== observed.revision ||
          afterWrite?.sourceIdentity !== observed.sourceIdentity ||
          (afterWrite.revision !== observed.revision &&
            (afterWrite.credentials.accessToken !== result.credentials.accessToken ||
              afterWrite.credentials.refreshToken !== result.credentials.refreshToken ||
              afterWrite.credentials.expiresAtMs !== result.credentials.expiresAtMs))
        ) {
          await observe(lifetime.signal)
          return null
        }
        source = afterWrite
      }
      failures = 0
      retryAt = 0
      if (current?.lineageId !== observed.lineageId) return null
      current = { ...current, credentials: result.credentials }
      return result.credentials.accessToken
    })()
    flight = operation.finally(() => {
      flight = null
    })
    return awaitFlight(flight, signal)
  }
  const awaitFlight = (
    operation: Promise<string | null>,
    signal: AbortSignal,
  ): Promise<string | null> => {
    if (signal.aborted) return Promise.reject(new OperationCancelledError("claude-token-manager"))
    const waiting = Promise.withResolvers<string | null>()
    const cancel = (): void => waiting.reject(new OperationCancelledError("claude-token-manager"))
    signal.addEventListener("abort", cancel, { once: true })
    operation
      .then(waiting.resolve, waiting.reject)
      .finally(() => signal.removeEventListener("abort", cancel))
    return waiting.promise
  }
  const readCredentialObservation = async (
    signal: AbortSignal,
  ): Promise<ClaudeCredentialObservation | null> => {
    const observed = await observe(signal)
    if (
      observed === null ||
      policy.mode === "never" ||
      !claudeAccessNeedsRefresh(observed.credentials, options.clock.nowMs(), policy.leadMs)
    )
      return observed
    if (observed.credentials.refreshToken === null)
      return observed.credentials.expiresAtMs === null ||
        observed.credentials.expiresAtMs > options.clock.nowMs()
        ? observed
        : null
    await refresh(observed, signal)
    ensureActive(signal)
    return current !== null &&
      (current.credentials.expiresAtMs === null ||
        current.credentials.expiresAtMs > options.clock.nowMs())
      ? current
      : null
  }
  const readAccessToken = async (signal: AbortSignal): Promise<string | null> =>
    (await readCredentialObservation(signal))?.credentials.accessToken ?? null
  const forceRefreshAccessToken = async (signal: AbortSignal): Promise<string | null> => {
    const previous = current?.credentials.accessToken ?? null
    const observed = await observe(signal)
    if (observed === null) return null
    if (policy.mode === "never")
      return observed.credentials.accessToken === previous ? null : observed.credentials.accessToken
    return refresh(observed, signal)
  }
  const dispose = (): Promise<void> => {
    if (cleanup !== null) return cleanup
    disposed = true
    lifetime.abort()
    current = null
    source = null
    cleanup = (async (): Promise<void> => {
      if (flight !== null) {
        try {
          await flight
        } catch (error: unknown) {
          if (
            !(error instanceof OperationCancelledError) &&
            !(lifetime.signal.aborted && error instanceof Error && error.name === "AbortError")
          )
            throw error
        }
      }
    })()
    return cleanup
  }
  return {
    readCredentialObservation,
    readAccessToken,
    forceRefreshAccessToken,
    dispose,
    [Symbol.asyncDispose]: dispose,
  }
}

export function createClaudeTokenReader(
  options: ClaudeTokenOptions,
): (signal: AbortSignal) => Promise<string | null> {
  return createClaudeTokenManager(options).readAccessToken
}
