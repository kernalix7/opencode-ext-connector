import type { Clock } from "../core/clock"
import {
  type ConnectorLogger,
  createConnectorLogger,
  type LogRecord,
  type LogSink,
} from "../core/logger"

export function createConsoleLogSink(): LogSink {
  return {
    write(record: LogRecord): void {
      console.info(JSON.stringify(record))
    },
  }
}

export function createConsoleLogger(clock: Clock): ConnectorLogger {
  return createConnectorLogger(clock, createConsoleLogSink())
}
