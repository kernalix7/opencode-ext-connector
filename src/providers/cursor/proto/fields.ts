import type { ProtoField } from "../proto-wire"
import { decodeUtf8Strict, decodeVarintNumberStrict } from "../proto-wire"
import { CursorProtocolDriftError, CursorProtocolError } from "./errors"
import { encodeUnknownField } from "./unknown-field"

export type FieldSpec = {
  readonly context: string
  readonly field: number
  readonly wire: number
}

export type ProtoDriftMetadata = {
  readonly unknownFields: readonly ProtoField[]
  readonly stranding: boolean
}

function verifyWire(entry: ProtoField, spec: FieldSpec): ProtoField {
  if (entry.wire !== spec.wire) {
    throw new CursorProtocolError(
      "wrong-wire",
      spec.context,
      `field ${spec.field} expected wire ${spec.wire}, received ${entry.wire}`,
    )
  }
  return entry
}

export function assertKnownFields(
  fields: readonly ProtoField[],
  allowed: readonly number[],
  context: string,
): void {
  const unknown = fields.find((entry) => !allowed.includes(entry.field))
  if (unknown !== undefined) {
    throw new CursorProtocolDriftError(context, unknown.field)
  }
}

export function collectDriftMetadata(
  fields: readonly ProtoField[],
  allowed: readonly number[],
  stranding = false,
): ProtoDriftMetadata | undefined {
  const unknownFields = fields.filter((entry) => !allowed.includes(entry.field))
  return unknownFields.length === 0 ? undefined : { unknownFields, stranding }
}

export function encodeDriftFields(drift: ProtoDriftMetadata | undefined): Uint8Array {
  if (drift === undefined) {
    return new Uint8Array()
  }
  const encoded = drift.unknownFields.map((entry) =>
    encodeUnknownField(entry.field, entry.wire, entry.bytes),
  )
  let length = 0
  for (const field of encoded) length += field.length
  const output = new Uint8Array(length)
  let offset = 0
  for (const field of encoded) {
    output.set(field, offset)
    offset += field.length
  }
  return output
}

export function repeatedFields(
  fields: readonly ProtoField[],
  spec: FieldSpec,
): readonly ProtoField[] {
  const matches: ProtoField[] = []
  for (const entry of fields) {
    if (entry.field === spec.field) {
      matches.push(verifyWire(entry, spec))
    }
  }
  return matches
}

export function optionalField(
  fields: readonly ProtoField[],
  spec: FieldSpec,
): ProtoField | undefined {
  const matches = repeatedFields(fields, spec)
  if (matches.length > 1) {
    throw new CursorProtocolError(
      "malformed",
      spec.context,
      `field ${spec.field} appears more than once`,
    )
  }
  return matches.at(0)
}

export function requiredField(fields: readonly ProtoField[], spec: FieldSpec): ProtoField {
  const entry = optionalField(fields, spec)
  if (entry === undefined) {
    throw new CursorProtocolError(
      "malformed",
      spec.context,
      `required field ${spec.field} is absent`,
    )
  }
  return entry
}

export function oneofField(
  fields: readonly ProtoField[],
  allowed: readonly number[],
  context: string,
): ProtoField {
  const matches = fields.filter((entry) => allowed.includes(entry.field))
  if (matches.length !== 1) {
    throw new CursorProtocolError(
      "malformed",
      context,
      `expected one variant, received ${matches.length}`,
    )
  }
  const entry = matches.at(0)
  if (entry === undefined) {
    throw new CursorProtocolError("malformed", context, "oneof variant is absent")
  }
  return verifyWire(entry, { context, field: entry.field, wire: 2 })
}

export function requiredString(fields: readonly ProtoField[], spec: FieldSpec): string {
  return decodeUtf8Strict(requiredField(fields, spec).bytes, `${spec.context} field ${spec.field}`)
}

export function optionalString(fields: readonly ProtoField[], spec: FieldSpec): string | undefined {
  const entry = optionalField(fields, spec)
  return entry === undefined
    ? undefined
    : decodeUtf8Strict(entry.bytes, `${spec.context} field ${spec.field}`)
}

export function requiredUint32(fields: readonly ProtoField[], spec: FieldSpec): number {
  return decodeVarintNumberStrict(
    requiredField(fields, spec).bytes,
    `${spec.context} field ${spec.field}`,
  )
}

export function optionalUint32(fields: readonly ProtoField[], spec: FieldSpec): number | undefined {
  const entry = optionalField(fields, spec)
  return entry === undefined
    ? undefined
    : decodeVarintNumberStrict(entry.bytes, `${spec.context} field ${spec.field}`)
}

export function optionalBool(fields: readonly ProtoField[], spec: FieldSpec): boolean | undefined {
  const value = optionalUint32(fields, spec)
  if (value === undefined) {
    return undefined
  }
  if (value !== 0 && value !== 1) {
    throw new CursorProtocolError("malformed", spec.context, `field ${spec.field} is not boolean`)
  }
  return value === 1
}
