import { CursorProtocolError } from "./proto/errors"

export const MAX_PROTO_MESSAGE_BYTES: number = 64 * 1024 * 1024

export type ProtoField = {
  readonly field: number
  readonly wire: number
  readonly bytes: Uint8Array
}

export type ProtoDecodeOptions = {
  readonly context?: string
  readonly maxBytes?: number
}

function encodeVarint(value: number): Uint8Array {
  const out: number[] = []
  let remaining = value >>> 0
  while (remaining > 0x7f) {
    out.push((remaining & 0x7f) | 0x80)
    remaining >>>= 7
  }
  out.push(remaining)
  return Uint8Array.from(out)
}

function decodeVarint(
  buffer: Uint8Array,
  offset: number,
): { readonly value: number; readonly next: number } | null {
  let value = 0
  let shift = 0
  let index = offset
  while (index < buffer.length) {
    const byte = buffer[index]
    if (byte === undefined) {
      return null
    }
    index += 1
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return { value, next: index }
    }
    shift += 7
    if (shift > 35) {
      return null
    }
  }
  return null
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) {
    length += part.length
  }
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function encodeBytesField(field: number, value: Uint8Array): Uint8Array {
  return concatBytes([encodeVarint((field << 3) | 2), encodeVarint(value.length), value])
}

export function encodeBoolField(field: number, value: boolean): Uint8Array {
  return concatBytes([encodeVarint((field << 3) | 0), encodeVarint(value ? 1 : 0)])
}

export function encodeInt32Field(field: number, value: number): Uint8Array {
  return concatBytes([encodeVarint((field << 3) | 0), encodeVarint(value >>> 0)])
}

export function encodeDoubleField(field: number, value: number): Uint8Array {
  const raw = new Uint8Array(8)
  new DataView(raw.buffer).setFloat64(0, value, true)
  return concatBytes([encodeVarint((field << 3) | 1), raw])
}

export function encodeStringField(field: number, value: string): Uint8Array {
  return encodeBytesField(field, new TextEncoder().encode(value))
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

export function decodeVarintNumber(bytes: Uint8Array): number {
  const decoded = decodeVarint(bytes, 0)
  return decoded === null ? 0 : decoded.value
}

export function decodeFields(buffer: Uint8Array): readonly ProtoField[] {
  const fields: ProtoField[] = []
  let offset = 0
  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset)
    if (tag === null) {
      break
    }
    const field = tag.value >>> 3
    const wire = tag.value & 7
    offset = tag.next
    if (wire === 0) {
      const varint = decodeVarint(buffer, offset)
      if (varint === null) {
        break
      }
      fields.push({ field, wire, bytes: buffer.subarray(tag.next, varint.next) })
      offset = varint.next
      continue
    }
    if (wire === 1) {
      const end = offset + 8
      if (end > buffer.length) {
        break
      }
      fields.push({ field, wire, bytes: buffer.subarray(offset, end) })
      offset = end
      continue
    }
    if (wire === 2) {
      const length = decodeVarint(buffer, offset)
      if (length === null) {
        break
      }
      const start = length.next
      const end = start + length.value
      if (end > buffer.length) {
        break
      }
      fields.push({ field, wire, bytes: buffer.subarray(start, end) })
      offset = end
      continue
    }
    break
  }
  return fields
}

function decodeRawVarintStrict(
  buffer: Uint8Array,
  offset: number,
  context: string,
): { readonly next: number; readonly raw: Uint8Array } {
  for (let index = offset; index < offset + 10; index += 1) {
    const byte = buffer[index]
    if (byte === undefined) {
      throw new CursorProtocolError("truncated", context, "incomplete varint")
    }
    if (index === offset + 9 && byte > 1) {
      throw new CursorProtocolError("malformed", context, "uint64 varint overflow")
    }
    if ((byte & 0x80) === 0) {
      return { next: index + 1, raw: buffer.subarray(offset, index + 1) }
    }
  }
  throw new CursorProtocolError("malformed", context, "varint exceeds ten bytes")
}

function decodeVarintStrict(
  buffer: Uint8Array,
  offset: number,
  context: string,
): { readonly value: number; readonly next: number } {
  const decoded = decodeRawVarintStrict(buffer, offset, context)
  if (decoded.raw.length > 5 || (decoded.raw.length === 5 && (decoded.raw[4] ?? 0) > 0x0f)) {
    throw new CursorProtocolError("malformed", context, "uint32 varint overflow")
  }
  let value = 0
  let factor = 1
  for (const byte of decoded.raw) {
    value += (byte & 0x7f) * factor
    factor *= 0x80
  }
  return { value, next: decoded.next }
}

function fixedFieldEnd(offset: number, width: number, length: number, context: string): number {
  const end = offset + width
  if (end > length) {
    throw new CursorProtocolError("truncated", context, `fixed${width * 8} field is incomplete`)
  }
  return end
}

export function decodeUtf8Strict(bytes: Uint8Array, context = "protobuf string"): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new CursorProtocolError("malformed", context, "invalid UTF-8")
    }
    throw error
  }
}

export function decodeVarintNumberStrict(bytes: Uint8Array, context = "protobuf uint32"): number {
  const decoded = decodeVarintStrict(bytes, 0, context)
  if (decoded.next !== bytes.length) {
    throw new CursorProtocolError("malformed", context, "varint has trailing bytes")
  }
  return decoded.value
}

export function decodeFieldsStrict(
  buffer: Uint8Array,
  options: ProtoDecodeOptions = {},
): readonly ProtoField[] {
  const context = options.context ?? "protobuf message"
  const maxBytes = options.maxBytes ?? MAX_PROTO_MESSAGE_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new CursorProtocolError("malformed", context, "invalid message size bound")
  }
  if (buffer.length > maxBytes) {
    throw new CursorProtocolError("oversized", context, `message exceeds ${maxBytes} bytes`)
  }

  const fields: ProtoField[] = []
  let offset = 0
  while (offset < buffer.length) {
    const tag = decodeVarintStrict(buffer, offset, `${context} tag`)
    const field = Math.floor(tag.value / 8)
    const wire = tag.value % 8
    if (field === 0) {
      throw new CursorProtocolError("malformed", context, "field number zero")
    }
    offset = tag.next
    switch (wire) {
      case 0: {
        const value = decodeRawVarintStrict(buffer, offset, `${context} field ${field}`)
        fields.push({ field, wire, bytes: buffer.subarray(offset, value.next) })
        offset = value.next
        break
      }
      case 1: {
        const end = fixedFieldEnd(offset, 8, buffer.length, `${context} field ${field}`)
        fields.push({ field, wire, bytes: buffer.subarray(offset, end) })
        offset = end
        break
      }
      case 2: {
        const length = decodeVarintStrict(buffer, offset, `${context} field ${field} length`)
        const end = length.next + length.value
        if (end > buffer.length) {
          throw new CursorProtocolError(
            "truncated",
            context,
            `field ${field} payload is incomplete`,
          )
        }
        fields.push({ field, wire, bytes: buffer.subarray(length.next, end) })
        offset = end
        break
      }
      case 5: {
        const end = fixedFieldEnd(offset, 4, buffer.length, `${context} field ${field}`)
        fields.push({ field, wire, bytes: buffer.subarray(offset, end) })
        offset = end
        break
      }
      default:
        throw new CursorProtocolError("wrong-wire", context, `unsupported wire type ${wire}`)
    }
  }
  return fields
}
