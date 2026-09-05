import { Buffer } from "node:buffer"

import { sanitizeBridgeEvent } from "./bridge-event-sanitize.js"
import { MAX_BRIDGE_LINE_LENGTH } from "./bridge-limits.js"
import {
  type BridgeCommand,
  type BridgeEvent,
  type BridgeEventSerializationContext,
  CursorBridgeProtocolError,
} from "./bridge-protocol.js"

function assertNever(value: never): never {
  void value
  throw new CursorBridgeProtocolError("invalid-message")
}

function encodeBase64(payload: Uint8Array): string {
  return Buffer.from(payload).toString("base64")
}

function serializeLine(value: object): string {
  const line = JSON.stringify(value)
  if (line.length > MAX_BRIDGE_LINE_LENGTH) {
    throw new CursorBridgeProtocolError("line-too-long")
  }
  return `${line}\n`
}

export function serializeBridgeCommand(command: BridgeCommand): string {
  switch (command.kind) {
    case "open":
    case "abort":
    case "close":
      return serializeLine(command)
    case "write-frame":
      return serializeLine({
        kind: command.kind,
        id: command.id,
        payload: encodeBase64(command.payload),
      })
    default:
      return assertNever(command)
  }
}

export function serializeBridgeEvent(
  event: BridgeEvent,
  context: BridgeEventSerializationContext,
): string {
  const sanitized = sanitizeBridgeEvent(event, context.accessToken)
  switch (sanitized.kind) {
    case "opened":
    case "headers":
    case "trailers":
    case "end":
    case "error":
      return serializeLine(sanitized)
    case "data":
      return serializeLine({
        kind: sanitized.kind,
        id: sanitized.id,
        payload: encodeBase64(sanitized.payload),
      })
    default:
      return assertNever(sanitized)
  }
}
