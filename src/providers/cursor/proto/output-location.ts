// Derived from Rahularya01/pi-cursor proto/agent.proto OutputLocation fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { concatBytes, decodeFieldsStrict, encodeStringField } from "../proto-wire.js"
import { CursorProtocolError } from "./errors.js"
import { assertKnownFields, optionalField, optionalString } from "./fields.js"
import { encodeUnknownField } from "./unknown-field.js"

export type OutputLocation = {
  readonly filePath: string
  readonly sizeBytes: bigint
  readonly lineCount: bigint
}

const UINT64_MODULUS = 1n << 64n
const INT64_SIGN = 1n << 63n

function decodeInt64(bytes: Uint8Array): bigint {
  let value = 0n
  let shift = 0n
  for (const byte of bytes) {
    value |= BigInt(byte & 0x7f) << shift
    shift += 7n
  }
  return value >= INT64_SIGN ? value - UINT64_MODULUS : value
}

function encodeInt64(value: bigint): Uint8Array {
  if (value < -INT64_SIGN || value >= INT64_SIGN) {
    throw new CursorProtocolError("malformed", "protobuf int64", "value is out of range")
  }
  const output: number[] = []
  let remaining = value < 0n ? value + UINT64_MODULUS : value
  do {
    const byte = Number(remaining & 0x7fn)
    remaining >>= 7n
    output.push(remaining === 0n ? byte : byte | 0x80)
  } while (remaining !== 0n)
  return Uint8Array.from(output)
}

export function decodeOutputLocation(bytes: Uint8Array): OutputLocation {
  const context = "OutputLocation"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3], context)
  const size = optionalField(fields, { context, field: 2, wire: 0 })
  const lines = optionalField(fields, { context, field: 3, wire: 0 })
  return {
    filePath: optionalString(fields, { context, field: 1, wire: 2 }) ?? "",
    sizeBytes: size === undefined ? 0n : decodeInt64(size.bytes),
    lineCount: lines === undefined ? 0n : decodeInt64(lines.bytes),
  }
}

export function encodeOutputLocation(location: OutputLocation): Uint8Array {
  return concatBytes([
    ...(location.filePath === "" ? [] : [encodeStringField(1, location.filePath)]),
    ...(location.sizeBytes === 0n
      ? []
      : [encodeUnknownField(2, 0, encodeInt64(location.sizeBytes))]),
    ...(location.lineCount === 0n
      ? []
      : [encodeUnknownField(3, 0, encodeInt64(location.lineCount))]),
  ])
}
