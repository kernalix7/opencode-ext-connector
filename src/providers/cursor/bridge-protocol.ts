import { MAX_BRIDGE_LINE_LENGTH } from "./bridge-limits.js"
import { parseBridgeCommandLine, parseBridgeEventLine } from "./bridge-wire.js"

export { sanitizeBridgeEvent } from "./bridge-event-sanitize.js"
export {
  MAX_BRIDGE_BASE64_CHARACTERS,
  MAX_BRIDGE_BINARY_BYTES,
  MAX_BRIDGE_LINE_LENGTH,
} from "./bridge-limits.js"
export { serializeBridgeCommand, serializeBridgeEvent } from "./bridge-serialize.js"
export { parseBridgeCommandLine, parseBridgeEventLine } from "./bridge-wire.js"

export type BridgeCommand =
  | {
      readonly kind: "open"
      readonly id: string
      readonly accessToken: string
      readonly path: string
      readonly headers: Readonly<Record<string, string>>
    }
  | { readonly kind: "write-frame"; readonly id: string; readonly payload: Uint8Array }
  | { readonly kind: "abort"; readonly id: string }
  | { readonly kind: "close"; readonly id: string }

export type BridgeEvent =
  | { readonly kind: "opened"; readonly id: string }
  | {
      readonly kind: "headers"
      readonly id: string
      readonly status: number
      readonly headers: Readonly<Record<string, string>>
    }
  | { readonly kind: "data"; readonly id: string; readonly payload: Uint8Array }
  | {
      readonly kind: "trailers"
      readonly id: string
      readonly headers: Readonly<Record<string, string>>
    }
  | { readonly kind: "end"; readonly id: string }
  | { readonly kind: "error"; readonly id: string; readonly code: string; readonly message: string }

export type BridgeEventSerializationContext = { readonly accessToken: string }

export type CursorBridgeProtocolErrorCode =
  | "malformed-json"
  | "invalid-message"
  | "invalid-base64"
  | "line-too-long"
  | "incomplete-line"

export class CursorBridgeProtocolError extends Error {
  public override readonly name = "CursorBridgeProtocolError"
  public constructor(public readonly code: CursorBridgeProtocolErrorCode) {
    super("cursor bridge protocol error")
  }
  public toJSON(): { readonly name: string; readonly code: CursorBridgeProtocolErrorCode } {
    return { name: this.name, code: this.code }
  }
}

export type BridgeLineDecoderOptions = { readonly maximumLineLength?: number }
export interface BridgeLineDecoder<T> {
  push(chunk: string): readonly T[]
  finish(): readonly T[]
}

function createBridgeLineDecoder<T>(
  options: BridgeLineDecoderOptions,
  parseLine: (line: string) => T,
): BridgeLineDecoder<T> {
  const maximumLineLength = options.maximumLineLength ?? MAX_BRIDGE_LINE_LENGTH
  let buffered = ""
  const parseLines = (lines: readonly string[]): readonly T[] =>
    lines.map((line) => {
      if (line.length > maximumLineLength) {
        throw new CursorBridgeProtocolError("line-too-long")
      }
      return parseLine(line)
    })
  return {
    push(chunk: string): readonly T[] {
      const lines = `${buffered}${chunk}`.split("\n")
      buffered = lines.pop() ?? ""
      if (buffered.length > maximumLineLength) {
        throw new CursorBridgeProtocolError("line-too-long")
      }
      return parseLines(lines)
    },
    finish(): readonly T[] {
      if (buffered.length > 0) {
        throw new CursorBridgeProtocolError("incomplete-line")
      }
      return []
    },
  }
}

export function createBridgeCommandLineDecoder(
  options: BridgeLineDecoderOptions = {},
): BridgeLineDecoder<BridgeCommand> {
  return createBridgeLineDecoder(options, parseBridgeCommandLine)
}

export function createBridgeEventLineDecoder(
  options: BridgeLineDecoderOptions = {},
): BridgeLineDecoder<BridgeEvent> {
  return createBridgeLineDecoder(options, parseBridgeEventLine)
}
