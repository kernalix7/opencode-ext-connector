import { describe, expect, it } from "bun:test"

import {
  type BridgeCommand,
  type BridgeEvent,
  CursorBridgeProtocolError,
  type CursorBridgeProtocolErrorCode,
  createBridgeCommandLineDecoder,
  MAX_BRIDGE_BASE64_CHARACTERS,
  MAX_BRIDGE_BINARY_BYTES,
  MAX_BRIDGE_LINE_LENGTH,
  parseBridgeCommandLine,
  parseBridgeEventLine,
  serializeBridgeCommand,
  serializeBridgeEvent,
} from "../../../../src/providers/cursor/bridge-protocol"
import { MAX_CONNECT_FRAME_BYTES } from "../../../../src/providers/cursor/connect-frame"
import { FakeCursorBridge } from "../../../support/cursor-bridge"

function captureProtocolError(action: () => void): CursorBridgeProtocolError {
  try {
    action()
  } catch (error) {
    if (error instanceof CursorBridgeProtocolError) {
      return error
    }
    throw error
  }
  throw new Error("expected CursorBridgeProtocolError")
}

describe("Cursor bridge protocol", () => {
  it("round-trips every parent command with binary frame fidelity", () => {
    // Given
    const commands: BridgeCommand[] = [
      {
        kind: "open",
        id: "stream-1",
        accessToken: "cursor-access-token",
        path: "/agent.v1.AgentService/Run",
        headers: { "content-type": "application/connect+proto" },
      },
      { kind: "write-frame", id: "stream-1", payload: new Uint8Array([0, 255, 1]) },
      { kind: "abort", id: "stream-1" },
      { kind: "close", id: "stream-1" },
    ]

    // When
    const parsed = commands.map((command) =>
      parseBridgeCommandLine(serializeBridgeCommand(command)),
    )

    // Then
    expect(parsed).toEqual(commands)
  })

  it("round-trips every child event with binary data fidelity", () => {
    // Given
    const events: BridgeEvent[] = [
      { kind: "opened", id: "stream-1" },
      {
        kind: "headers",
        id: "stream-1",
        status: 200,
        headers: { "content-type": "application/connect+proto" },
      },
      { kind: "data", id: "stream-1", payload: new Uint8Array([3, 0, 254]) },
      { kind: "trailers", id: "stream-1", headers: { "grpc-status": "0" } },
      { kind: "end", id: "stream-1" },
      { kind: "error", id: "stream-1", code: "unavailable", message: "bridge unavailable" },
    ]

    // When
    const parsed = events.map((event) =>
      parseBridgeEventLine(serializeBridgeEvent(event, { accessToken: "event-access-token" })),
    )

    // Then
    expect(parsed).toEqual(events)
  })

  it("rejects malformed, unknown, invalid binary, id, header, and oversized command input", () => {
    // Given
    const invalidCases: readonly {
      readonly line: string
      readonly code: CursorBridgeProtocolErrorCode
    }[] = [
      { line: "{", code: "malformed-json" },
      { line: '{"kind":"unknown"}', code: "invalid-message" },
      {
        line: '{"kind":"write-frame","id":"stream-1","payload":"not base64!"}',
        code: "invalid-base64",
      },
      { line: '{"kind":"abort","id":"bad id"}', code: "invalid-message" },
      {
        line: '{"kind":"open","id":"stream-1","accessToken":"token","path":"/run","headers":{"bad header":"x"}}',
        code: "invalid-message",
      },
      {
        line: '{"kind":"open","id":"stream-1","accessToken":"token","path":"/run","headers":{"authorization":"Bearer token"}}',
        code: "invalid-message",
      },
    ]

    // When
    const errors = invalidCases.map(({ line }) =>
      captureProtocolError(() => parseBridgeCommandLine(line)),
    )
    const decoder = createBridgeCommandLineDecoder({ maximumLineLength: 8 })
    const oversized = captureProtocolError(() => decoder.push("123456789"))

    // Then
    expect(errors.map((error) => error.code)).toEqual(invalidCases.map(({ code }) => code))
    expect(oversized.code).toBe("line-too-long")
  })

  it("rejects access-token fields in child events and redacts tokens from errors", () => {
    // Given
    const token = "cursor-secret-token"
    const tokenEvent = `{"kind":"opened","id":"stream-1","accessToken":"${token}"}`
    const invalidOpen = `{"kind":"open","id":"bad id","accessToken":"${token}","path":"/run","headers":{}}`

    // When
    const eventError = captureProtocolError(() => parseBridgeEventLine(tokenEvent))
    const commandError = captureProtocolError(() => parseBridgeCommandLine(invalidOpen))

    // Then
    expect(eventError.code).toBe("invalid-message")
    expect(JSON.stringify(commandError)).not.toContain(token)
    expect(commandError.message).not.toContain(token)
  })

  it("carries a frame above 64 KiB and below the Connect frame maximum", () => {
    // Given
    const payload = new Uint8Array(64 * 1024 + 1)
    payload.fill(255)
    const command = serializeBridgeCommand({ kind: "write-frame", id: "stream-1", payload })

    // When
    const parsed = parseBridgeCommandLine(command)

    // Then
    expect(payload.length).toBeLessThan(MAX_CONNECT_FRAME_BYTES)
    expect(MAX_BRIDGE_BINARY_BYTES).toBe(MAX_CONNECT_FRAME_BYTES)
    expect(MAX_BRIDGE_BASE64_CHARACTERS).toBe(Math.ceil(MAX_CONNECT_FRAME_BYTES / 3) * 4)
    expect(command.length - 1).toBeLessThanOrEqual(MAX_BRIDGE_LINE_LENGTH)
    expect(parsed).toEqual({ kind: "write-frame", id: "stream-1", payload })
  })

  it("rejects noncanonical base64 and blank NDJSON lines", () => {
    // Given
    const noncanonical = '{"kind":"data","id":"stream-1","payload":"AQ="}'
    const decoder = createBridgeCommandLineDecoder()

    // When
    const base64Error = captureProtocolError(() => parseBridgeEventLine(noncanonical))
    const blankLineError = captureProtocolError(() => decoder.push("\n"))

    // Then
    expect(base64Error.code).toBe("invalid-base64")
    expect(blankLineError.code).toBe("malformed-json")
  })

  it("preserves error codes and sanitizes token-bearing messages and response headers", () => {
    // Given
    const token = "cursor-secret-token"
    const event: BridgeEvent = {
      kind: "error",
      id: "stream-1",
      code: "stream-error",
      message: `failed for ${token}`,
    }
    const headers: BridgeEvent = {
      kind: "headers",
      id: "stream-1",
      status: 401,
      headers: {
        authorization: `Bearer ${token}`,
        "set-cookie": `session=${token}`,
        "x-api-key": token,
        "x-request-id": `trace-${token}`,
      },
    }

    // When
    const errorLine = serializeBridgeEvent(event, { accessToken: token })
    const headerLine = serializeBridgeEvent(headers, { accessToken: token })

    // Then
    expect(errorLine).not.toContain(token)
    expect(headerLine).not.toContain(token)
    expect(parseBridgeEventLine(errorLine)).toEqual({
      kind: "error",
      id: "stream-1",
      code: "stream-error",
      message: "failed for [REDACTED]",
    })
    expect(parseBridgeEventLine(headerLine)).toEqual({
      kind: "headers",
      id: "stream-1",
      status: 401,
      headers: { "x-request-id": "trace-[REDACTED]" },
    })
  })

  it("parses fragmented and multiple NDJSON lines in the in-memory fake without recording tokens", () => {
    // Given
    const token = "cursor-secret-token"
    const fake = new FakeCursorBridge({ accessToken: token })
    const open = serializeBridgeCommand({
      kind: "open",
      id: "stream-1",
      accessToken: token,
      path: "/agent.v1.AgentService/Run",
      headers: {},
    })
    const abort = serializeBridgeCommand({ kind: "abort", id: "stream-1" })
    const data = serializeBridgeEvent(
      { kind: "data", id: "stream-1", payload: new Uint8Array([7, 8]) },
      { accessToken: token },
    )
    const end = serializeBridgeEvent({ kind: "end", id: "stream-1" }, { accessToken: token })
    const rawError = `{"kind":"error","id":"stream-1","code":"upstream","message":"failed ${token}"}\n`

    // When
    fake.receiveCommandChunk(open.slice(0, 10))
    fake.receiveCommandChunk(`${open.slice(10)}${abort}`)
    fake.receiveEventChunk(data.slice(0, 9))
    fake.receiveEventChunk(`${data.slice(9)}${end}${rawError}`)

    // Then
    expect(fake.commands.map((command) => command.kind)).toEqual(["open", "abort"])
    expect(fake.events.map((event) => event.kind)).toEqual(["data", "end", "error"])
    expect(fake.events[0]).toEqual({
      kind: "data",
      id: "stream-1",
      payload: new Uint8Array([7, 8]),
    })
    expect(JSON.stringify(fake.commands)).not.toContain(token)
    expect(JSON.stringify(fake.events)).not.toContain(token)
  })

  it("rejects stale buffered fragments when the fake input closes", () => {
    // Given
    const fake = new FakeCursorBridge({ accessToken: "cursor-access-token" })

    // When
    fake.receiveEventChunk('{"kind":"end"')
    const error = captureProtocolError(() => fake.finishEvents())

    // Then
    expect(error.code).toBe("incomplete-line")
  })

  it("uses a configurable line bound to reject oversized input without large allocation", () => {
    // Given
    const decoder = createBridgeCommandLineDecoder({ maximumLineLength: 16 })
    const line = serializeBridgeCommand({
      kind: "write-frame",
      id: "stream-1",
      payload: new Uint8Array([1]),
    })

    // When
    const error = captureProtocolError(() => decoder.push(line))

    // Then
    expect(error.code).toBe("line-too-long")
  })
})
