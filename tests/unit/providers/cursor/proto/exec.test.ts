import { describe, expect, it } from "bun:test"

import {
  decodeExecClientMessage,
  decodeExecServerMessage,
  encodeExecClientMessage,
  encodeExecServerMessage,
} from "../../../../../src/providers/cursor/proto/exec"
import {
  decodeKvClientMessage,
  decodeKvServerMessage,
  encodeKvClientMessage,
  encodeKvServerMessage,
} from "../../../../../src/providers/cursor/proto/kv"
import {
  decodeMcpArgs,
  decodeMcpResult,
  encodeMcpArgs,
  encodeMcpResult,
  type McpResult,
} from "../../../../../src/providers/cursor/proto/mcp"

function varint(value: number): readonly number[] {
  const bytes: number[] = []
  let remaining = value
  while (remaining > 0x7f) {
    bytes.push((remaining % 0x80) | 0x80)
    remaining = Math.floor(remaining / 0x80)
  }
  bytes.push(remaining)
  return bytes
}

function bytesField(field: number, value: ArrayLike<number> & Iterable<number>): readonly number[] {
  return [...varint((field << 3) | 2), ...varint(value.length), ...value]
}

function uintField(field: number, value: number): readonly number[] {
  return [...varint(field << 3), ...varint(value)]
}

function stringField(field: number, value: string): readonly number[] {
  return bytesField(field, new TextEncoder().encode(value))
}

const MCP_ARGS_FIXTURE = Uint8Array.from([
  ...stringField(1, "read"),
  ...bytesField(2, [...stringField(1, "command"), ...bytesField(2, stringField(3, "pwd"))]),
  ...stringField(3, "call-1"),
  ...stringField(4, "opencode"),
  ...stringField(5, "read"),
])

const MCP_SUCCESS_FIXTURE = Uint8Array.from(
  bytesField(1, [...bytesField(1, bytesField(1, stringField(1, "ok"))), ...uintField(2, 0)]),
)

describe("Cursor MCP codecs", () => {
  it("decodes protobuf Value map entries in McpArgs", () => {
    // Given
    const expected = {
      name: "read",
      args: { command: "pwd" },
      toolCallId: "call-1",
      providerIdentifier: "opencode",
      toolName: "read",
    }

    // When
    const decoded = decodeMcpArgs(MCP_ARGS_FIXTURE)

    // Then
    expect(decoded).toEqual(expected)
    expect(encodeMcpArgs(expected)).toEqual(MCP_ARGS_FIXTURE)
  })

  it("falls back to strict UTF-8 for MCP arg bytes that are not protobuf Value", () => {
    // Given
    const text = new TextEncoder().encode("plain text")
    const fixture = Uint8Array.from([
      ...stringField(1, "read"),
      ...bytesField(2, [...stringField(1, "query"), ...bytesField(2, text)]),
      ...stringField(3, "call-text"),
      ...stringField(4, "opencode"),
      ...stringField(5, "read"),
    ])

    // When
    const decoded = decodeMcpArgs(fixture)

    // Then
    expect(decoded.args).toEqual({ query: "plain text" })
  })

  it("does not turn malformed known protobuf Value into text", () => {
    // Given
    const malformedBoolean = Uint8Array.from([
      ...stringField(1, "read"),
      ...bytesField(2, [...stringField(1, "query"), ...bytesField(2, uintField(4, 2))]),
      ...stringField(3, "call-bool"),
      ...stringField(4, "opencode"),
      ...stringField(5, "read"),
    ])

    // When
    const decode = (): void => {
      decodeMcpArgs(malformedBoolean)
    }

    // Then
    expect(decode).toThrow("invalid boolean value")
  })

  it("applies proto3 defaults to omitted McpArgs scalar fields", () => {
    // Given
    const fixture = new Uint8Array()

    // When
    const decoded = decodeMcpArgs(fixture)

    // Then
    expect(decoded).toEqual({
      name: "",
      args: {},
      toolCallId: "",
      providerIdentifier: "",
      toolName: "",
    })
    expect(encodeMcpArgs(decoded)).toEqual(fixture)
  })

  it("decodes and re-encodes MCP text success content", () => {
    // Given
    const expected: McpResult = {
      kind: "success",
      content: [{ kind: "text", text: "ok" }],
      isError: false,
    }

    // When
    const decoded = decodeMcpResult(MCP_SUCCESS_FIXTURE)

    // Then
    expect(decoded).toEqual(expected)
    expect(encodeMcpResult(decoded)).toEqual(MCP_SUCCESS_FIXTURE)
  })

  it("distinguishes every minimum MCP result variant", () => {
    // Given
    const fixtures = [
      MCP_SUCCESS_FIXTURE,
      Uint8Array.from(bytesField(2, stringField(1, "failed"))),
      Uint8Array.from(bytesField(3, [...stringField(1, "no"), ...uintField(2, 1)])),
      Uint8Array.from(bytesField(4, [...stringField(1, "denied"), ...uintField(2, 0)])),
      Uint8Array.from(
        bytesField(5, [
          ...stringField(1, "missing"),
          ...stringField(2, "read"),
          ...stringField(2, "write"),
        ]),
      ),
    ]

    // When
    const kinds = fixtures.map((fixture) => decodeMcpResult(fixture).kind)

    // Then
    expect(kinds).toEqual(["success", "error", "rejected", "permission-denied", "tool-not-found"])
  })
})

describe("Cursor KV codecs", () => {
  it("defaults an omitted proto3 server id to zero", () => {
    // Given
    const fixture = Uint8Array.from(
      bytesField(3, [...bytesField(1, [0xbb]), ...bytesField(2, [1, 2])]),
    )

    // When
    const message = decodeKvServerMessage(fixture)

    // Then
    expect(message).toEqual({
      kind: "set-blob",
      id: 0,
      blobId: Uint8Array.from([0xbb]),
      blobData: Uint8Array.from([1, 2]),
    })
  })

  it("round-trips get and set blob server messages", () => {
    // Given
    const getFixture = Uint8Array.from([
      ...uintField(1, 3),
      ...bytesField(2, bytesField(1, [0xaa])),
    ])
    const setFixture = Uint8Array.from([
      ...uintField(1, 4),
      ...bytesField(3, [...bytesField(1, [0xbb]), ...bytesField(2, [1, 2])]),
    ])

    // When
    const getMessage = decodeKvServerMessage(getFixture)
    const setMessage = decodeKvServerMessage(setFixture)

    // Then
    expect(getMessage).toEqual({ kind: "get-blob", id: 3, blobId: Uint8Array.from([0xaa]) })
    expect(setMessage).toEqual({
      kind: "set-blob",
      id: 4,
      blobId: Uint8Array.from([0xbb]),
      blobData: Uint8Array.from([1, 2]),
    })
    expect(encodeKvServerMessage(getMessage)).toEqual(getFixture)
    expect(encodeKvServerMessage(setMessage)).toEqual(setFixture)
  })

  it("round-trips get and set blob client results", () => {
    // Given
    const getFixture = Uint8Array.from([
      ...uintField(1, 5),
      ...bytesField(2, bytesField(1, [0xcc])),
    ])
    const setFixture = Uint8Array.from([...uintField(1, 6), ...bytesField(3, [])])

    // When
    const getMessage = decodeKvClientMessage(getFixture)
    const setMessage = decodeKvClientMessage(setFixture)

    // Then
    expect(getMessage).toEqual({
      kind: "get-blob-result",
      id: 5,
      blobData: Uint8Array.from([0xcc]),
    })
    expect(setMessage).toEqual({ kind: "set-blob-result", id: 6 })
    expect(encodeKvClientMessage(getMessage)).toEqual(getFixture)
    expect(encodeKvClientMessage(setMessage)).toEqual(setFixture)
  })
})

describe("Cursor exec codecs", () => {
  it("validates then ignores hook-context acceptance on native frames", () => {
    // Given
    const fixture = Uint8Array.from([
      ...uintField(1, 7),
      ...bytesField(2, [1]),
      ...stringField(15, "native"),
      ...uintField(55, 1),
    ])
    // When
    const message = decodeExecServerMessage(fixture)
    // Then
    expect(message.kind).toBe("native")
    expect(Object.hasOwn(message, "acceptHookAdditionalContexts")).toBe(false)
    expect(encodeExecServerMessage(message)).toEqual(fixture.slice(0, -3))
  })

  it("round-trips MCP args and request-context server variants", () => {
    // Given
    const mcpFixture = Uint8Array.from([
      ...uintField(1, 7),
      ...bytesField(11, MCP_ARGS_FIXTURE),
      ...stringField(15, "exec-1"),
    ])
    const contextFixture = Uint8Array.from([
      ...uintField(1, 8),
      ...bytesField(10, [...stringField(2, "notes"), ...stringField(3, "workspace")]),
      ...stringField(15, "exec-2"),
    ])

    // When
    const mcpMessage = decodeExecServerMessage(mcpFixture)
    const contextMessage = decodeExecServerMessage(contextFixture)

    // Then
    expect(mcpMessage.kind).toBe("mcp-args")
    expect(contextMessage.kind).toBe("request-context-args")
    expect(encodeExecServerMessage(mcpMessage)).toEqual(mcpFixture)
    expect(encodeExecServerMessage(contextMessage)).toEqual(contextFixture)
  })

  it("round-trips MCP and request-context client results", () => {
    // Given
    const mcpFixture = Uint8Array.from([
      ...uintField(1, 9),
      ...bytesField(11, MCP_SUCCESS_FIXTURE),
      ...stringField(15, "exec-3"),
    ])
    const context = bytesField(7, [
      ...stringField(1, "read"),
      ...stringField(2, "Read files"),
      ...bytesField(3, stringField(3, "schema")),
      ...stringField(4, "opencode"),
      ...stringField(5, "read"),
    ])
    const contextFixture = Uint8Array.from([
      ...uintField(1, 10),
      ...bytesField(10, bytesField(1, bytesField(1, context))),
      ...stringField(15, "exec-4"),
    ])

    // When
    const mcpMessage = decodeExecClientMessage(mcpFixture)
    const contextMessage = decodeExecClientMessage(contextFixture)

    // Then
    expect(mcpMessage.kind).toBe("mcp-result")
    expect(contextMessage.kind).toBe("request-context-result")
    expect(encodeExecClientMessage(mcpMessage)).toEqual(mcpFixture)
    expect(encodeExecClientMessage(contextMessage)).toEqual(contextFixture)
  })
})
