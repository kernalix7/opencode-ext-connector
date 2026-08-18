export interface ScheduledCallback extends Disposable {
  cancel(): void
}

export interface Clock {
  nowMs(): number
  schedule(delayMs: number, callback: () => void): ScheduledCallback
}
