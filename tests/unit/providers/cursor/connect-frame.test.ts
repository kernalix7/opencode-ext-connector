import { describe, expect, it } from "bun:test"
import * as connectFrameModule from "../../../../src/providers/cursor/connect-frame"
import {
  decodeConnectFrames,
  decodeConnectFramesStrict,
  encodeConnectFrame,
} from "../../../../src/providers/cursor/connect-frame"
import { encodeStringField } from "../../../../src/providers/cursor/proto-wire"

describe("encodeConnectFrame", () => {
  it("prefixes protobuf with a 5-byte Connect envelope", () => {
    // Given
    const message = encodeStringField(1, "hi")

    // When
    const frame = encodeConnectFrame(message)
    const decoded = decodeConnectFrames(frame)

    // Then
    expect(decoded).toHaveLength(1)
    expect(decoded[0]?.endStream).toBe(false)
    expect(decoded[0]?.bytes).toEqual(message)
  })

  it("requires a negotiated decompressor before exposing compressed protobuf", () => {
    // Given
    const compressedBytes = Uint8Array.from([0x1f, 0x8b])
    const frame = decodeConnectFramesStrict(
      encodeConnectFrame(compressedBytes, { compressed: true }),
    ).at(0)
    const decodePayload = Reflect.get(connectFrameModule, "decodeConnectFramePayload")
    if (frame === undefined || typeof decodePayload !== "function") {
      throw new Error("decodeConnectFramePayload must be exported")
    }

    // When
    let receivedCap = 0
    const withoutNegotiation = (): void => {
      Reflect.apply(decodePayload, undefined, [frame, { maxOutputBytes: 1 }])
    }
    const decompressed = Reflect.apply(decodePayload, undefined, [
      frame,
      {
        maxOutputBytes: 1,
        decompressor: (bytes: Uint8Array, maxOutputBytes: number): Uint8Array => {
          receivedCap = maxOutputBytes
          return bytes.subarray(1)
        },
      },
    ])

    // Then
    expect(withoutNegotiation).toThrow("negotiated decompressor")
    expect(decompressed).toEqual(Uint8Array.from([0x8b]))
    expect(receivedCap).toBe(1)
  })

  it("rejects decompressed output larger than the caller cap", () => {
    // Given
    const frame = decodeConnectFramesStrict(
      encodeConnectFrame(Uint8Array.from([0x1f]), { compressed: true }),
    ).at(0)
    const decodePayload = Reflect.get(connectFrameModule, "decodeConnectFramePayload")
    if (frame === undefined || typeof decodePayload !== "function") {
      throw new Error("decodeConnectFramePayload must be exported")
    }

    // When
    const decode = (): void => {
      Reflect.apply(decodePayload, undefined, [
        frame,
        {
          maxOutputBytes: 2,
          decompressor: (_bytes: Uint8Array, _maxOutputBytes: number): Uint8Array =>
            Uint8Array.from([1, 2, 3]),
        },
      ])
    }

    // Then
    expect(decode).toThrow("decompressed message exceeds 2 bytes")
  })

  it("rejects a compressed end-stream envelope", () => {
    // Given
    const frame = encodeConnectFrame(new Uint8Array(), {
      compressed: true,
      endStream: true,
    })

    // When
    const decode = (): void => {
      decodeConnectFramesStrict(frame)
    }

    // Then
    expect(decode).toThrow("end-stream envelope cannot be compressed")
  })
})
