export type HealthPolicy = {
  readonly initialBackoffMs: number
  readonly maximumBackoffMs: number
}

export type HealthState = {
  readonly status: "unknown" | "ready" | "stale" | "unavailable"
  readonly consecutiveFailures: number
  readonly retryAtMs: number | null
}

export type HealthEvent =
  | { readonly status: "ready"; readonly atMs: number }
  | { readonly status: "stale"; readonly atMs: number }
  | { readonly status: "unavailable"; readonly atMs: number }

export function createInitialHealthState(): HealthState {
  return { status: "unknown", consecutiveFailures: 0, retryAtMs: null }
}

export function calculateBackoffMs(failures: number, policy: HealthPolicy): number {
  if (failures <= 0) {
    return 0
  }
  let delay = Math.min(policy.initialBackoffMs, policy.maximumBackoffMs)
  let remainingFailures = failures - 1
  while (remainingFailures > 0 && delay < policy.maximumBackoffMs) {
    delay = Math.min(delay * 2, policy.maximumBackoffMs)
    remainingFailures -= 1
  }
  return delay
}

export function reduceHealth(
  state: HealthState,
  event: HealthEvent,
  policy: HealthPolicy,
): HealthState {
  switch (event.status) {
    case "ready":
      return { status: "ready", consecutiveFailures: 0, retryAtMs: null }
    case "stale":
    case "unavailable": {
      const consecutiveFailures = state.consecutiveFailures + 1
      return {
        status: event.status,
        consecutiveFailures,
        retryAtMs: event.atMs + calculateBackoffMs(consecutiveFailures, policy),
      }
    }
  }
}
