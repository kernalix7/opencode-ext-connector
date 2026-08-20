import type { Clock } from "./clock"

export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogValue =
  | null
  | boolean
  | number
  | string
  | readonly LogValue[]
  | { readonly [key: string]: LogValue }
export type LogFields = { readonly [key: string]: LogValue }
export type LogRecord = {
  readonly timestampMs: number
  readonly level: LogLevel
  readonly event: string
  readonly fields: LogFields
}

export interface LogSink {
  write(record: LogRecord): void
}

export interface ConnectorLogger {
  log(level: LogLevel, event: string, fields: LogFields): void
}

const REDACTED = "[REDACTED]"
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "token",
    "accesstoken",
    "refreshtoken",
    "access",
    "refresh",
    "expires",
    "apikey",
  "password",
  "secret",
])

function isLogArray(value: LogValue): value is readonly LogValue[] {
  return Array.isArray(value)
}

function sanitizeUrl(value: string): string {
  if (!URL.canParse(value)) {
    return value
  }
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return value
  }
  if (url.username.length > 0) url.username = REDACTED
  if (url.password.length > 0) url.password = REDACTED
  const queryNames = [...url.searchParams.keys()]
  if (queryNames.length > 0) {
    url.search = ""
    for (const name of queryNames) url.searchParams.append(name, REDACTED)
  }
  return url.toString()
}

function sanitizeValue(value: LogValue): LogValue {
  if (typeof value === "string") {
    return sanitizeUrl(value)
  }
  if (value === null || typeof value !== "object") {
    return value
  }
  if (isLogArray(value)) {
    return value.map(sanitizeValue)
  }
  return sanitizeFields(value)
}

function sanitizeFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      const normalizedKey = key.toLowerCase().replaceAll("-", "").replaceAll("_", "")
      return [key, SENSITIVE_KEYS.has(normalizedKey) ? REDACTED : sanitizeValue(value)]
    }),
  )
}

export function createConnectorLogger(clock: Clock, sink: LogSink): ConnectorLogger {
  return {
    log: (level, event, fields): void =>
      sink.write({ timestampMs: clock.nowMs(), level, event, fields: sanitizeFields(fields) }),
  }
}
