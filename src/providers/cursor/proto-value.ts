// Derived from Rahularya01/pi-cursor protobuf Value handling. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { CursorProtocolDriftError, CursorProtocolError } from "./proto/errors"
import { assertKnownFields, repeatedFields, requiredField, requiredString } from "./proto/fields"
import {
  concatBytes,
  decodeFields,
  decodeFieldsStrict,
  decodeUtf8,
  decodeUtf8Strict,
  decodeVarintNumber,
  decodeVarintNumberStrict,
  encodeBoolField,
  encodeBytesField,
  encodeDoubleField,
  encodeStringField,
} from "./proto-wire"

function encodeStruct(value: Record<string, unknown>): Uint8Array {
  const entries: Uint8Array[] = []
  for (const key of Object.keys(value)) {
    entries.push(
      encodeBytesField(
        1,
        concatBytes([
          encodeStringField(1, key),
          encodeBytesField(2, encodeProtobufValue(value[key])),
        ]),
      ),
    )
  }
  return concatBytes(entries)
}

function decodeStruct(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const entry of decodeFields(bytes)) {
    if (entry.field !== 1) {
      continue
    }
    const fields = decodeFields(entry.bytes)
    let key = ""
    let value: unknown = null
    for (const inner of fields) {
      if (inner.field === 1) {
        key = decodeUtf8(inner.bytes)
      }
      if (inner.field === 2) {
        value = decodeProtobufValue(inner.bytes)
      }
    }
    if (key.length > 0) {
      result[key] = value
    }
  }
  return result
}

export function decodeProtobufValue(bytes: Uint8Array): unknown {
  const [entry] = decodeFields(bytes)
  if (entry === undefined) {
    return null
  }
  switch (entry.field) {
    case 1:
      return null
    case 2:
      if (entry.bytes.length < 8) {
        return 0
      }
      return new DataView(entry.bytes.buffer, entry.bytes.byteOffset, 8).getFloat64(0, true)
    case 3:
      return decodeUtf8(entry.bytes)
    case 4:
      return decodeVarintNumber(entry.bytes) !== 0
    case 5:
      return decodeStruct(entry.bytes)
    case 6: {
      const values: unknown[] = []
      for (const item of decodeFields(entry.bytes)) {
        if (item.field === 1) {
          values.push(decodeProtobufValue(item.bytes))
        }
      }
      return values
    }
    default:
      return null
  }
}

export function encodeProtobufValue(value: unknown): Uint8Array {
  if (value === null || value === undefined) {
    return encodeBoolField(1, false)
  }
  if (typeof value === "number") {
    return encodeDoubleField(2, value)
  }
  if (typeof value === "string") {
    return encodeStringField(3, value)
  }
  if (typeof value === "boolean") {
    return encodeBoolField(4, value)
  }
  if (Array.isArray(value)) {
    return encodeBytesField(
      6,
      concatBytes(value.map((item) => encodeBytesField(1, encodeProtobufValue(item)))),
    )
  }
  if (typeof value === "object") {
    const record: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      record[key] = Reflect.get(value, key)
    }
    return encodeBytesField(5, encodeStruct(record))
  }
  return encodeStringField(3, String(value))
}

function decodeStructStrict(bytes: Uint8Array): Readonly<Record<string, unknown>> {
  const context = "google.protobuf.Struct"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1], context)
  const result: Record<string, unknown> = {}
  for (const entry of repeatedFields(fields, { context, field: 1, wire: 2 })) {
    const entryContext = "google.protobuf.Struct.FieldsEntry"
    const mapFields = decodeFieldsStrict(entry.bytes, { context: entryContext })
    assertKnownFields(mapFields, [1, 2], entryContext)
    const key = requiredString(mapFields, { context: entryContext, field: 1, wire: 2 })
    const value = requiredField(mapFields, { context: entryContext, field: 2, wire: 2 })
    if (Object.hasOwn(result, key)) {
      throw new CursorProtocolError("malformed", entryContext, `duplicate key ${key}`)
    }
    result[key] = decodeProtobufValueStrict(value.bytes)
  }
  return result
}

function decodeListStrict(bytes: Uint8Array): readonly unknown[] {
  const context = "google.protobuf.ListValue"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1], context)
  return repeatedFields(fields, { context, field: 1, wire: 2 }).map((entry) =>
    decodeProtobufValueStrict(entry.bytes),
  )
}

export function decodeProtobufValueStrict(bytes: Uint8Array): unknown {
  const context = "google.protobuf.Value"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5, 6], context)
  if (fields.length !== 1) {
    throw new CursorProtocolError(
      "malformed",
      context,
      `expected one variant, received ${fields.length}`,
    )
  }
  const entry = fields.at(0)
  if (entry === undefined) {
    throw new CursorProtocolError("malformed", context, "Value variant is absent")
  }
  switch (entry.field) {
    case 1: {
      if (entry.wire !== 0 || decodeVarintNumberStrict(entry.bytes, context) !== 0) {
        throw new CursorProtocolError("malformed", context, "invalid null variant")
      }
      return null
    }
    case 2: {
      if (entry.wire !== 1 || entry.bytes.length !== 8) {
        throw new CursorProtocolError("wrong-wire", context, "invalid number variant")
      }
      const value = new DataView(entry.bytes.buffer, entry.bytes.byteOffset, 8).getFloat64(0, true)
      if (!Number.isFinite(value)) {
        throw new CursorProtocolError("malformed", context, "number is not finite")
      }
      return value
    }
    case 3:
      if (entry.wire !== 2) {
        throw new CursorProtocolError("wrong-wire", context, "invalid string variant")
      }
      return decodeUtf8Strict(entry.bytes, context)
    case 4: {
      if (entry.wire !== 0) {
        throw new CursorProtocolError("wrong-wire", context, "invalid boolean variant")
      }
      const value = decodeVarintNumberStrict(entry.bytes, context)
      if (value !== 0 && value !== 1) {
        throw new CursorProtocolError("malformed", context, "invalid boolean value")
      }
      return value === 1
    }
    case 5:
      return decodeStructStrict(entry.bytes)
    case 6:
      return decodeListStrict(entry.bytes)
    default:
      throw new CursorProtocolDriftError(context, entry.field, "unsupported Value variant")
  }
}
