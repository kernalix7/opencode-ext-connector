import { z } from "zod"

import {
  CONNECT_COMPRESSED,
  CONNECT_END_STREAM,
  MAX_CONNECT_FRAME_BYTES,
  MAX_CONNECT_MESSAGE_BYTES,
} from "./connect-frame.js"
import { CursorProtocolError } from "./proto/errors.js"

const ConnectCodeSchema = z.enum([
  "canceled",
  "unknown",
  "invalid_argument",
  "deadline_exceeded",
  "not_found",
  "already_exists",
  "permission_denied",
  "resource_exhausted",
  "failed_precondition",
  "aborted",
  "out_of_range",
  "unimplemented",
  "internal",
  "unavailable",
  "data_loss",
  "unauthenticated",
])

const ConnectEndStreamSchema = z
  .object({
    error: z
      .object({
        code: ConnectCodeSchema,
        message: z.string().min(1),
        details: z.array(z.unknown()).optional(),
      })
      .strict()
      .optional(),
    metadata: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict()

export type ConnectStreamFrame =
  | { readonly kind: "message"; readonly bytes: Uint8Array }
  | {
      readonly kind: "end"
      readonly error: { readonly code: string; readonly message: string } | null
    }

export type ConnectFrameStreamDecoder = {
  readonly push: (chunk: Uint8Array) => readonly ConnectStreamFrame[]
  readonly finish: () => void
}

export type ConnectFrameStreamDecoderOptions = {
  readonly maxFrameBytes?: number
  readonly maxMessageBytes?: number
}

function validateBound(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CursorProtocolError("malformed", "Connect stream", "invalid size bound")
  }
}

function parseEndStream(bytes: Uint8Array): Extract<ConnectStreamFrame, { readonly kind: "end" }> {
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw new CursorProtocolError("malformed", "Connect end-stream", "invalid UTF-8")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(decoded)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw new CursorProtocolError("malformed", "Connect end-stream", "invalid JSON")
  }
  const result = ConnectEndStreamSchema.safeParse(parsed)
  if (!result.success) {
    throw new CursorProtocolError("malformed", "Connect end-stream", "invalid envelope")
  }
  const error = result.data.error
  return {
    kind: "end",
    error: error === undefined ? null : { code: error.code, message: error.message },
  }
}

export function createConnectFrameStreamDecoder(
  options: ConnectFrameStreamDecoderOptions = {},
): ConnectFrameStreamDecoder {
  const maxMessageBytes = options.maxMessageBytes ?? MAX_CONNECT_MESSAGE_BYTES
  const maxFrameBytes = options.maxFrameBytes ?? MAX_CONNECT_FRAME_BYTES
  validateBound(maxMessageBytes)
  validateBound(maxFrameBytes)
  const header = new Uint8Array(5)
  let headerBytes = 0
  let payload = new Uint8Array()
  let payloadBytes = 0
  let endStream = false
  let ended = false

  const reset = (): void => {
    headerBytes = 0
    payload = new Uint8Array()
    payloadBytes = 0
    endStream = false
  }

  const complete = (): ConnectStreamFrame => {
    const frame: ConnectStreamFrame = endStream
      ? parseEndStream(payload)
      : { kind: "message", bytes: payload }
    if (endStream) ended = true
    reset()
    return frame
  }

  const parseHeader = (): ConnectStreamFrame | null => {
    const flags = header.at(0)
    if (flags === undefined) {
      throw new CursorProtocolError("truncated", "Connect stream", "frame flags are absent")
    }
    if ((flags & ~(CONNECT_COMPRESSED | CONNECT_END_STREAM)) !== 0) {
      throw new CursorProtocolError(
        "unsupported-flags",
        "Connect stream",
        `unsupported flags 0x${flags.toString(16)}`,
      )
    }
    if ((flags & CONNECT_COMPRESSED) !== 0) {
      throw new CursorProtocolError(
        "unsupported-flags",
        "Connect stream",
        "compressed payload requires a negotiated decompressor",
      )
    }
    const length = new DataView(header.buffer, header.byteOffset + 1, 4).getUint32(0)
    if (length > maxMessageBytes) {
      throw new CursorProtocolError(
        "oversized",
        "Connect stream",
        `message exceeds ${maxMessageBytes} bytes`,
      )
    }
    if (length + 5 > maxFrameBytes) {
      throw new CursorProtocolError(
        "oversized",
        "Connect stream",
        `frame exceeds ${maxFrameBytes} bytes`,
      )
    }
    endStream = (flags & CONNECT_END_STREAM) !== 0
    payload = new Uint8Array(length)
    return length === 0 ? complete() : null
  }

  return {
    push(chunk): readonly ConnectStreamFrame[] {
      if (ended && chunk.length > 0) {
        throw new CursorProtocolError("malformed", "Connect stream", "data follows end-stream")
      }
      const frames: ConnectStreamFrame[] = []
      let offset = 0
      while (offset < chunk.length) {
        if (headerBytes < header.length) {
          const count = Math.min(header.length - headerBytes, chunk.length - offset)
          header.set(chunk.subarray(offset, offset + count), headerBytes)
          headerBytes += count
          offset += count
          if (headerBytes < header.length) continue
          const empty = parseHeader()
          if (empty !== null) frames.push(empty)
          if (ended && offset < chunk.length) {
            throw new CursorProtocolError("malformed", "Connect stream", "data follows end-stream")
          }
          if (headerBytes === 0) continue
        }
        const count = Math.min(payload.length - payloadBytes, chunk.length - offset)
        payload.set(chunk.subarray(offset, offset + count), payloadBytes)
        payloadBytes += count
        offset += count
        if (payloadBytes === payload.length) {
          frames.push(complete())
          if (ended && offset < chunk.length) {
            throw new CursorProtocolError("malformed", "Connect stream", "data follows end-stream")
          }
        }
      }
      return frames
    },
    finish(): void {
      if (headerBytes !== 0 || payloadBytes !== 0) {
        throw new CursorProtocolError("truncated", "Connect stream", "trailing partial frame")
      }
    },
  }
}
