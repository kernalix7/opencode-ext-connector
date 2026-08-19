import type { Clock } from "../core/clock"
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
  const arm = (): void => {
    scheduled = options.clock.schedule(options.intervalMs, () => {
      if (cancelled) {
        return
      }
      arm()
      void options.reload()
    })
  }
  let scheduled = options.clock.schedule(options.intervalMs, () => undefined)
  scheduled.cancel()
  arm()
  return createAsyncDisposable(() => {
    cancelled = true
    scheduled.cancel()
  })
}
