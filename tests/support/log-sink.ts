import type { LogRecord, LogSink } from "../../src/core/logger"

export class MemoryLogSink implements LogSink {
  public readonly records: LogRecord[] = []
  public write(record: LogRecord): void {
    this.records.push(record)
  }
}
