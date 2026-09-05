// Derived from Rahularya01/pi-cursor proto/agent.proto exec control fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
} from "../proto-wire.js"
import { CursorProtocolDriftError, unreachableVariant } from "./errors.js"
import { oneofField, optionalString, optionalUint32 } from "./fields.js"

export type ExecClientControl =
  | { readonly kind: "stream-close"; readonly id: number }
  | {
      readonly kind: "throw"
      readonly id: number
      readonly error: string
      readonly stackTrace?: string
    }
  | { readonly kind: "heartbeat"; readonly id: number }

export type ExecServerControl = { readonly kind: "abort"; readonly id: number }

function controlId(bytes: Uint8Array, context: string): number {
  const fields = decodeFieldsStrict(bytes, { context })
  return optionalUint32(fields, { context, field: 1, wire: 0 }) ?? 0
}

export function decodeExecClientControl(bytes: Uint8Array): ExecClientControl {
  const context = "ExecClientControlMessage"
  const fields = decodeFieldsStrict(bytes, { context })
  const message = oneofField(fields, [1, 2, 3], context)
  if (message.field === 1)
    return { kind: "stream-close", id: controlId(message.bytes, "ExecClientStreamClose") }
  if (message.field === 3)
    return { kind: "heartbeat", id: controlId(message.bytes, "ExecClientHeartbeat") }
  if (message.field === 2) {
    const itemContext = "ExecClientThrow"
    const item = decodeFieldsStrict(message.bytes, { context: itemContext })
    const stackTrace = optionalString(item, { context: itemContext, field: 3, wire: 2 })
    return {
      kind: "throw",
      id: optionalUint32(item, { context: itemContext, field: 1, wire: 0 }) ?? 0,
      error: optionalString(item, { context: itemContext, field: 2, wire: 2 }) ?? "",
      ...(stackTrace === undefined ? {} : { stackTrace }),
    }
  }
  throw new CursorProtocolDriftError(context, message.field)
}

export function encodeExecClientControl(control: ExecClientControl): Uint8Array {
  switch (control.kind) {
    case "stream-close":
      return encodeBytesField(1, encodeInt32Field(1, control.id))
    case "throw":
      return encodeBytesField(
        2,
        concatBytes([
          encodeInt32Field(1, control.id),
          encodeStringField(2, control.error),
          ...(control.stackTrace === undefined ? [] : [encodeStringField(3, control.stackTrace)]),
        ]),
      )
    case "heartbeat":
      return encodeBytesField(3, encodeInt32Field(1, control.id))
    default:
      return unreachableVariant(control, "ExecClientControlMessage")
  }
}

export function decodeExecServerControl(bytes: Uint8Array): ExecServerControl {
  const context = "ExecServerControlMessage"
  const message = oneofField(decodeFieldsStrict(bytes, { context }), [1], context)
  return { kind: "abort", id: controlId(message.bytes, "ExecServerAbort") }
}

export function encodeExecServerControl(control: ExecServerControl): Uint8Array {
  return encodeBytesField(1, encodeInt32Field(1, control.id))
}
