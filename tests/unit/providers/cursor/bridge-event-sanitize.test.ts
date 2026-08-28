import { describe, expect, it } from "bun:test"

import {
  type BridgeEvent,
  parseBridgeEventLine,
  serializeBridgeEvent,
} from "../../../../src/providers/cursor/bridge-protocol"

describe("Cursor bridge event sanitization", () => {
  it("preserves stable error codes with a one-character access token", () => {
    // Given
    const accessToken = "t"
    const error: BridgeEvent = {
      kind: "error",
      id: "stream-1",
      code: "decompressed-body-too-large",
      message: "untrusted detail contains t",
    }
    const headers: BridgeEvent = {
      kind: "headers",
      id: "stream-1",
      status: 500,
      headers: { "x-safe": "contains t", "x-token-t": "secret t", "x-trace": "private" },
    }

    // When
    const errorLine = serializeBridgeEvent(error, { accessToken })
    const headerLine = serializeBridgeEvent(headers, { accessToken })
    const parsedError = parseBridgeEventLine(errorLine)
    const parsedHeaders = parseBridgeEventLine(headerLine)

    // Then
    expect(parsedError.kind).toBe("error")
    if (parsedError.kind !== "error") {
      throw new TypeError("expected error event")
    }
    expect(parsedError.code).toBe("decompressed-body-too-large")
    expect(parsedError.message).not.toContain(accessToken)
    expect(parsedHeaders.kind).toBe("headers")
    if (parsedHeaders.kind !== "headers") {
      throw new TypeError("expected headers event")
    }
    expect(parsedHeaders.headers).toEqual({ "x-safe": "con[REDACTED]ains [REDACTED]" })
    expect(Object.keys(parsedHeaders.headers).every((name) => !name.includes(accessToken))).toBe(
      true,
    )
    expect(
      Object.values(parsedHeaders.headers).every((value) => !value.includes(accessToken)),
    ).toBe(true)
  })
})
