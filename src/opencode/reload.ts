import type { Clock, ScheduledCallback } from "../core/clock"
import { createAsyncDisposable } from "../core/lifecycle"

export type CatalogReloadOptions = {
  readonly clock: Clock
  readonly intervalMs: number
  readonly reload: () => Promise<void>
}

export function scheduleCatalogReload(options: CatalogReloadOptions): {
  readonly dispose: () => Promise<void>
} {
  if (options.intervalMs <= 0) {
    return createAsyncDisposable(() => undefined)
  }
  let cancelled = false
  let scheduled: ScheduledCallback | undefined
  let activeReload: Promise<void> | undefined
  const arm = (): void => {
    scheduled = options.clock.schedule(options.intervalMs, () => {
      if (cancelled) {
        return
      }
      scheduled = undefined
      activeReload = options.reload().then(
        () => undefined,
        () => undefined,
      )
      void activeReload.then(() => {
        activeReload = undefined
        if (!cancelled) {
          arm()
        }
      })
    })
  }
  arm()
  return createAsyncDisposable(async () => {
    cancelled = true
    scheduled?.cancel()
    await activeReload
  })
}
