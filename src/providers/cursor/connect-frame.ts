// Derived from Rahularya01/pi-cursor Connect envelope handling. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { CursorProtocolError } from "./proto/errors.js"

export const CONNECT_COMPRESSED: number = 0x01
export const CONNECT_END_STREAM: number = 0x02
export const MAX_CONNECT_MESSAGE_BYTES: number = 64 * 1024 * 1024
export const MAX_CONNECT_FRAME_BYTES: number = MAX_CONNECT_MESSAGE_BYTES + 5

export type ConnectFrame = {
  readonly compressed: boolean
  readonly endStream: boolean
  readonly bytes: Uint8Array
}

export type ConnectFrameOptions = {
  readonly compressed?: boolean
  readonly endStream?: boolean
  readonly maxMessageBytes?: number
}

export type ConnectDecodeOptions = {
  readonly maxFrameBytes?: number
  readonly maxMessageBytes?: number
}

export type ConnectDecompressor = (bytes: Uint8Array, maxOutputBytes: number) => Uint8Array

export type ConnectPayloadDecodeOptions = {
  readonly maxOutputBytes: number
  readonly decompressor?: ConnectDecompressor
}

export function decodeConnectFramePayload(
  frame: ConnectFrame,
  options: ConnectPayloadDecodeOptions,
): Uint8Array {
  validateBound(options.maxOutputBytes, "Connect payload")
  if (frame.endStream) {
    throw new CursorProtocolError(
      "malformed",
      "Connect frame",
      "end-stream has no protobuf payload",
    )
  }
  if (!frame.compressed) {
    if (frame.bytes.length > options.maxOutputBytes) {
      throw new CursorProtocolError(
        "oversized",
        "Connect payload",
        `message exceeds ${options.maxOutputBytes} bytes`,
      )
    }
    return frame.bytes
  }
  if (options.decompressor === undefined) {
    throw new CursorProtocolError(
      "unsupported-flags",
      "Connect frame",
      "compressed payload requires a negotiated decompressor",
    )
  }
  const payload = options.decompressor(frame.bytes, options.maxOutputBytes)
  if (payload.length > options.maxOutputBytes) {
    throw new CursorProtocolError(
      "oversized",
      "Connect payload",
      `decompressed message exceeds ${options.maxOutputBytes} bytes`,
    )
  }
  return payload
}

function validateBound(value: number, context: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CursorProtocolError("malformed", context, "invalid size bound")
  }
}

export function encodeConnectFrame(
  message: Uint8Array,
  options: ConnectFrameOptions = {},
): Uint8Array {
  const maxMessageBytes = options.maxMessageBytes ?? MAX_CONNECT_MESSAGE_BYTES
  validateBound(maxMessageBytes, "Connect frame")
  if (message.length > maxMessageBytes) {
    throw new CursorProtocolError(
      "oversized",
      "Connect frame",
      `message exceeds ${maxMessageBytes} bytes`,
    )
  }
  const frame = new Uint8Array(5 + message.length)
  frame[0] =
    (options.compressed === true ? CONNECT_COMPRESSED : 0) |
    (options.endStream === true ? CONNECT_END_STREAM : 0)
  const view = new DataView(frame.buffer, frame.byteOffset, 5)
  view.setUint32(1, message.length)
  frame.set(message, 5)
  return frame
}

export function decodeConnectFrames(buffer: Uint8Array): readonly ConnectFrame[] {
  const frames: ConnectFrame[] = []
  let offset = 0
  while (offset + 5 <= buffer.length) {
    const flags = buffer[offset] ?? 0
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4)
    const length = view.getUint32(0)
    const start = offset + 5
    const end = start + length
    if (end > buffer.length) {
      break
    }
    frames.push({
      compressed: (flags & CONNECT_COMPRESSED) !== 0,
      endStream: (flags & CONNECT_END_STREAM) !== 0,
      bytes: buffer.subarray(start, end),
    })
    offset = end
  }
  return frames
}

export function decodeConnectFramesWithRest(buffer: Uint8Array): {
  readonly frames: readonly ConnectFrame[]
  readonly rest: Uint8Array
} {
  const frames = decodeConnectFrames(buffer)
  let offset = 0
  for (const frame of frames) {
    offset += 5 + frame.bytes.length
  }
  return { frames, rest: buffer.subarray(offset) }
}

export function decodeConnectFramesStrict(
  buffer: Uint8Array,
  options: ConnectDecodeOptions = {},
): readonly ConnectFrame[] {
  const context = "Connect frame"
  const maxMessageBytes = options.maxMessageBytes ?? MAX_CONNECT_MESSAGE_BYTES
  const maxFrameBytes = options.maxFrameBytes ?? MAX_CONNECT_FRAME_BYTES
  validateBound(maxMessageBytes, context)
  validateBound(maxFrameBytes, context)
  const frames: ConnectFrame[] = []
  let offset = 0
  while (offset < buffer.length) {
    if (buffer.length - offset < 5) {
      throw new CursorProtocolError("truncated", context, "frame header is incomplete")
    }
    const flags = buffer[offset]
    if (flags === undefined) {
      throw new CursorProtocolError("truncated", context, "frame flags are absent")
    }
    if ((flags & ~(CONNECT_COMPRESSED | CONNECT_END_STREAM)) !== 0) {
      throw new CursorProtocolError(
        "unsupported-flags",
        context,
        `unsupported flags 0x${flags.toString(16)}`,
      )
    }
    if (
      (flags & (CONNECT_COMPRESSED | CONNECT_END_STREAM)) ===
      (CONNECT_COMPRESSED | CONNECT_END_STREAM)
    ) {
      throw new CursorProtocolError(
        "unsupported-flags",
        context,
        "end-stream envelope cannot be compressed",
      )
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4)
    const length = view.getUint32(0)
    if (length > maxMessageBytes) {
      throw new CursorProtocolError(
        "oversized",
        context,
        `message exceeds ${maxMessageBytes} bytes`,
      )
    }
    if (length + 5 > maxFrameBytes) {
      throw new CursorProtocolError("oversized", context, `frame exceeds ${maxFrameBytes} bytes`)
    }
    const start = offset + 5
    const end = start + length
    if (end > buffer.length) {
      throw new CursorProtocolError("truncated", context, "frame payload is incomplete")
    }
    frames.push({
      compressed: (flags & CONNECT_COMPRESSED) !== 0,
      endStream: (flags & CONNECT_END_STREAM) !== 0,
      bytes: buffer.subarray(start, end),
    })
    offset = end
  }
  return frames
}
