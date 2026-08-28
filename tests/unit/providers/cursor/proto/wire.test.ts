import { describe, expect, it } from "bun:test"

import {
  CONNECT_COMPRESSED,
  decodeConnectFramesStrict,
} from "../../../../../src/providers/cursor/connect-frame"
import { decodeProtobufValueStrict } from "../../../../../src/providers/cursor/proto-value"
import {
  decodeFieldsStrict,
  decodeVarintNumberStrict,
} from "../../../../../src/providers/cursor/proto-wire"
import {
  PINNED_AGENT_PROTO_SHA256,
  PINNED_PI_CURSOR_VERSION,
  UINT64_OPAQUE_FIELD_FIXTURE,
} from "./static-fixtures"

describe("strict Cursor protobuf wire", () => {
  it("records the generated fixture source version and descriptor hash", () => {
    // Given
    const expectedVersion = "1.4.26"
    const expectedHash = "0760b83d6a9a5ad3911aaa00a345b71bd1147178b667917fd17e5826661af47c"

    // When
    const source = { version: PINNED_PI_CURSOR_VERSION, hash: PINNED_AGENT_PROTO_SHA256 }

    // Then
    expect(source).toEqual({ version: expectedVersion, hash: expectedHash })
  })

  it("preserves a ten-byte uint64 varint while keeping uint32 conversion bounded", () => {
    // Given
    const expectedVarint = UINT64_OPAQUE_FIELD_FIXTURE.subarray(1)

    // When
    const fields = decodeFieldsStrict(UINT64_OPAQUE_FIELD_FIXTURE)
    const convertToUint32 = (): void => {
      decodeVarintNumberStrict(expectedVarint)
    }

    // Then
    expect(fields.at(0)?.bytes).toEqual(expectedVarint)
    expect(convertToUint32).toThrow("uint32")
  })

  it("rejects a truncated length-delimited field", () => {
    // Given
    const truncated = Uint8Array.from([0x0a, 0x02, 0x61])

    // When
    const decode = (): void => {
      decodeFieldsStrict(truncated)
    }

    // Then
    expect(decode).toThrow("truncated")
  })

  it("rejects a field with an unsupported wire type", () => {
    // Given
    const wrongWire = Uint8Array.from([0x0b])

    // When
    const decode = (): void => {
      decodeFieldsStrict(wrongWire)
    }

    // Then
    expect(decode).toThrow("wire")
  })

  it("rejects a protobuf message above its configured bound", () => {
    // Given
    const oversized = Uint8Array.from([0x0a, 0x02, 0x61, 0x62])

    // When
    const decode = (): void => {
      decodeFieldsStrict(oversized, { maxBytes: 3 })
    }

    // Then
    expect(decode).toThrow("exceeds")
  })

  it("rejects a malformed protobuf Value instead of returning zero", () => {
    // Given
    const truncatedDouble = Uint8Array.from([0x11, 0x00])

    // When
    const decode = (): void => {
      decodeProtobufValueStrict(truncatedDouble)
    }

    // Then
    expect(decode).toThrow("truncated")
  })

  it("rejects an unknown protobuf Value variant as drift", () => {
    // Given
    const unknownVariant = Uint8Array.from([0x3a, 0x00])

    // When
    const decode = (): void => {
      decodeProtobufValueStrict(unknownVariant)
    }

    // Then
    expect(decode).toThrow("variant")
  })
})

describe("strict Connect frames", () => {
  it("exposes compressed and end-stream flags", () => {
    // Given
    const frames = Uint8Array.from([CONNECT_COMPRESSED, 0, 0, 0, 1, 0x2a, 0x02, 0, 0, 0, 0])

    // When
    const decoded = decodeConnectFramesStrict(frames)

    // Then
    expect(decoded).toEqual([
      { compressed: true, endStream: false, bytes: Uint8Array.from([0x2a]) },
      { compressed: false, endStream: true, bytes: new Uint8Array() },
    ])
  })

  it("rejects unsupported Connect flags", () => {
    // Given
    const unknownFlags = Uint8Array.from([0x04, 0, 0, 0, 0])

    // When
    const decode = (): void => {
      decodeConnectFramesStrict(unknownFlags)
    }

    // Then
    expect(decode).toThrow("flags")
  })

  it("rejects a declared Connect message above its bound", () => {
    // Given
    const oversized = Uint8Array.from([0, 0, 0, 0, 3, 1, 2, 3])

    // When
    const decode = (): void => {
      decodeConnectFramesStrict(oversized, { maxMessageBytes: 2 })
    }

    // Then
    expect(decode).toThrow("exceeds")
  })

  it("rejects a truncated final Connect frame", () => {
    // Given
    const truncated = Uint8Array.from([0, 0, 0, 0, 2, 1])

    // When
    const decode = (): void => {
      decodeConnectFramesStrict(truncated)
    }

    // Then
    expect(decode).toThrow("truncated")
  })
})
