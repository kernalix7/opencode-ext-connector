import { concatBytes } from "../proto-wire"
import { CursorProtocolError } from "./errors"

function encodeVarint(value: number): Uint8Array {
  const output: number[] = []
  let remaining = value >>> 0
  while (remaining > 0x7f) {
    output.push((remaining & 0x7f) | 0x80)
    remaining >>>= 7
  }
  output.push(remaining)
  return Uint8Array.from(output)
}

export function encodeUnknownField(field: number, wire: number, bytes: Uint8Array): Uint8Array {
  const tag = encodeVarint((field << 3) | wire)
  if (wire === 2) {
    return concatBytes([tag, encodeVarint(bytes.length), bytes])
  }
  if (wire === 0 || wire === 1 || wire === 5) {
    return concatBytes([tag, bytes])
  }
  throw new CursorProtocolError("wrong-wire", "protobuf field", `unsupported wire type ${wire}`)
}
