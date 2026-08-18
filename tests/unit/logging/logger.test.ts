import { describe, expect, it } from "bun:test"

import { createConsoleLogger } from "../../../src/logging/logger"
import { FakeClock } from "../../support/clock"

function readLoggedRecord(writes: readonly unknown[]): {
  readonly timestampMs: number
  readonly level: string
  readonly event: string
  readonly fields: { readonly [key: string]: unknown }
} {
  const first = writes.at(0)
  if (!Array.isArray(first)) {
    throw new Error("expected console.info arguments")
  }
  const raw = first.at(0)
  if (typeof raw !== "string") {
    throw new Error("expected JSON string")
  }
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("expected object")
  }
  if (
    !("timestampMs" in parsed) ||
    !("level" in parsed) ||
    !("event" in parsed) ||
    !("fields" in parsed)
  ) {
    throw new Error("expected log record")
  }
  const timestampMs = parsed.timestampMs
  const level = parsed.level
  const event = parsed.event
  const fields = parsed.fields
  if (typeof timestampMs !== "number" || typeof level !== "string" || typeof event !== "string") {
    throw new Error("invalid log record scalars")
  }
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    throw new Error("expected fields object")
  }
  return {
    timestampMs,
    level,
    event,
    fields: Object.fromEntries(Object.entries(fields)),
  }
}

describe("console logger", () => {
  it("logs info event with structured payload via console sink", () => {
    // Given
    const clock = new FakeClock(123456)
    const writes: unknown[] = []
    const originalInfo = console.info
    console.info = (...args: unknown[]) => {
      writes.push(args)
    }
    try {
      const logger = createConsoleLogger(clock)
      // When
      logger.log("info", "provider.ready", { provider: "claude" })
      // Then
      expect(writes).toHaveLength(1)
      expect(readLoggedRecord(writes)).toEqual({
        timestampMs: 123456,
        level: "info",
        event: "provider.ready",
        fields: { provider: "claude" },
      })
    } finally {
      console.info = originalInfo
    }
  })

  it("redacts sensitive keys without mutating input", () => {
    // Given
    const clock = new FakeClock(789)
    const writes: unknown[] = []
    const originalInfo = console.info
    console.info = (...args: unknown[]) => {
      writes.push(args)
    }
    try {
      const logger = createConsoleLogger(clock)
      const fields = { authorization: "secret", token: "abc", cookie: "c", normal: "value" }
      // When
      logger.log("warn", "provider.retry", fields)
      // Then
      expect(readLoggedRecord(writes).fields).toEqual({
        authorization: "[REDACTED]",
        token: "[REDACTED]",
        cookie: "[REDACTED]",
        normal: "value",
      })
      expect(fields.authorization).toBe("secret")
      expect(fields.token).toBe("abc")
      expect(fields.cookie).toBe("c")
    } finally {
      console.info = originalInfo
    }
  })

  it("redacts credentials and query values in HTTP URLs", () => {
    // Given
    const clock = new FakeClock(42)
    const writes: unknown[] = []
    const originalInfo = console.info
    console.info = (...args: unknown[]) => {
      writes.push(args)
    }
    try {
      const logger = createConsoleLogger(clock)
      const url = "https://user:pass@example.test/x?q=one"
      // When
      logger.log("debug", "request", { url })
      // Then
      const loggedFields = readLoggedRecord(writes).fields
      const sanitizedUrl = Object.entries(loggedFields)
        .find(([key]) => key === "url")
        ?.at(1)
      if (typeof sanitizedUrl !== "string") {
        throw new Error("expected sanitized url string")
      }
      expect(sanitizedUrl).not.toContain("user")
      expect(sanitizedUrl).not.toContain("pass")
      expect(sanitizedUrl).not.toContain("one")
      const parsed = new URL(sanitizedUrl)
      expect(parsed.username).not.toBe("user")
      expect(parsed.password).not.toBe("pass")
      expect(parsed.searchParams.get("q")).toBe("[REDACTED]")
    } finally {
      console.info = originalInfo
    }
  })
})
