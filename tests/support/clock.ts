import type { Clock, ScheduledCallback } from "../../src/core/clock"
import { InvalidArgumentError } from "../../src/core/errors"

type ScheduledRecord = {
  readonly id: number
  readonly dueMs: number
  readonly callback: () => void
  cancelled: boolean
}

export class FakeClock implements Clock {
  private currentMs: number
  private nextId = 0
  private readonly scheduled: ScheduledRecord[] = []

  public constructor(startMs = 0) {
    if (!Number.isSafeInteger(startMs)) {
      throw new InvalidArgumentError("startMs")
    }
    this.currentMs = startMs
  }

  public nowMs(): number {
    return this.currentMs
  }

  public schedule(delayMs: number, callback: () => void): ScheduledCallback {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      throw new InvalidArgumentError("delayMs")
    }
    const dueMs = this.currentMs + delayMs
    if (!Number.isSafeInteger(dueMs)) {
      throw new InvalidArgumentError("delayMs")
    }
    const record: ScheduledRecord = { id: this.nextId, dueMs, callback, cancelled: false }
    this.nextId += 1
    this.scheduled.push(record)
    const cancel = (): void => {
      record.cancelled = true
    }
    return { cancel, [Symbol.dispose]: cancel }
  }

  public advanceBy(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new InvalidArgumentError("milliseconds")
    }
    const targetMs = this.currentMs + milliseconds
    if (!Number.isSafeInteger(targetMs)) {
      throw new InvalidArgumentError("milliseconds")
    }

    while (true) {
      let next: ScheduledRecord | undefined
      for (const record of this.scheduled) {
        if (
          !record.cancelled &&
          record.dueMs <= targetMs &&
          (next === undefined ||
            record.dueMs < next.dueMs ||
            (record.dueMs === next.dueMs && record.id < next.id))
        ) {
          next = record
        }
      }
      if (next === undefined) {
        break
      }
      this.currentMs = next.dueMs
      next.cancelled = true
      next.callback()
    }
    this.currentMs = targetMs
  }

  public pendingCount(): number {
    return this.scheduled.filter(({ cancelled }) => !cancelled).length
  }
}
