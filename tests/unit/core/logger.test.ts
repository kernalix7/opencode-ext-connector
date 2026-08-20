import { describe, expect, it } from "bun:test"

import { createConnectorLogger } from "../../../src/core/logger"
import { FakeClock } from "../../support/clock"
import { MemoryLogSink } from "../../support/log-sink"

describe("connector logger", () => {
  it("writes structured records using the injected clock", () => {
    // Given
    const clock = new FakeClock(42)
    const sink = new MemoryLogSink()
    const logger = createConnectorLogger(clock, sink)
    // When
    logger.log("info", "provider.ready", { provider: "one" })
    // Then
    expect(sink.records).toEqual([
      { timestampMs: 42, level: "info", event: "provider.ready", fields: { provider: "one" } },
    ])
  })

  it("redacts nested sensitive keys without mutating input", () => {
    // Given
    const clock = new FakeClock()
    const sink = new MemoryLogSink()
    const logger = createConnectorLogger(clock, sink)
    const fields = { Authorization: "bearer secret", nested: [{ api_key: "value" }] }
    // When
    logger.log("warn", "provider.retry", fields)
    // Then
    expect(sink.records.at(0)?.fields).toEqual({
      Authorization: "[REDACTED]",
      nested: [{ api_key: "[REDACTED]" }],
    })
    expect(fields.Authorization).toBe("bearer secret")
  })

  it("redacts credentials and query values in HTTP URLs", () => {
    // Given
    const sink = new MemoryLogSink()
    const logger = createConnectorLogger(new FakeClock(), sink)
    const url = "https://user:pass@example.test/path?a=one&a=two#part"
    // When
    logger.log("debug", "request", { url })
    // Then
    const loggedFields = sink.records.at(0)?.fields
    const sanitized =
      loggedFields === undefined
        ? undefined
        : Object.entries(loggedFields)
            .find(([key]) => key === "url")
            ?.at(1)
    expect(typeof sanitized).toBe("string")
    expect(String(sanitized)).not.toContain("user")
    expect(String(sanitized)).not.toContain("one")
    expect(new URL(String(sanitized)).searchParams.getAll("a")).toEqual([
      "[REDACTED]",
      "[REDACTED]",
    ])
  })

  it("redacts OpenCode oauth token field names", () => {
    // Given
    const sink = new MemoryLogSink()
    const logger = createConnectorLogger(new FakeClock(), sink)
    // When
    logger.log("warn", "provider.auth", {
      access: "at",
      refresh: "rt",
      expires: 9,
      nested: { access_token: "n" },
    })
    // Then
    expect(sink.records.at(0)?.fields).toEqual({
      access: "[REDACTED]",
      refresh: "[REDACTED]",
      expires: "[REDACTED]",
      nested: { access_token: "[REDACTED]" },
    })
  })

  it("propagates sink failures", () => {
    // Given
    const failure = new TypeError("sink")
    const logger = createConnectorLogger(new FakeClock(), {
      write: () => {
        throw failure
      },
    })
    // When
    const log = () => logger.log("error", "provider.failed", {})
    // Then
    expect(log).toThrow(failure)
  })
})
