import { describe, expect, it } from "bun:test"

import { cursorServerReplies } from "../../../../src/providers/cursor/exec-reply"
import { CursorProtocolError } from "../../../../src/providers/cursor/proto/errors"
import {
  decodeExecClientMessage,
  decodeExecServerMessage,
  encodeExecServerMessage,
} from "../../../../src/providers/cursor/proto/exec"
import {
  concatBytes,
  encodeBoolField,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
} from "../../../../src/providers/cursor/proto-wire"

describe("metadata exec frames", () => {
  it("applies proto3 identity defaults to server and client oneof frames", () => {
    // Given
    const fixture = encodeBytesField(2, new Uint8Array([1]))

    // When
    const server = decodeExecServerMessage(fixture)
    const client = decodeExecClientMessage(fixture)

    // Then
    expect(server).toEqual({
      kind: "native",
      operation: "shell",
      field: 2,
      id: 0,
      execId: "",
      payload: new Uint8Array([1]),
    })
    expect(client).toEqual({
      kind: "native",
      operation: "shell",
      field: 2,
      id: 0,
      execId: "",
      payload: new Uint8Array([1]),
    })
  })

  it("decodes and semantically encodes false and true field-55-only metadata", () => {
    // Given
    const values = [false, true]

    // When
    const messages = values.map((value) => decodeExecServerMessage(encodeBoolField(55, value)))

    // Then
    for (const [index, value] of values.entries()) {
      const message = messages.at(index) ?? decodeExecServerMessage(new Uint8Array())
      const encoded = encodeExecServerMessage(message)
      expect(message).toEqual({
        kind: "metadata",
        id: 0,
        execId: "",
        acceptHookAdditionalContexts: value,
      })
      expect(encoded).toEqual(
        concatBytes([
          encodeInt32Field(1, 0),
          encodeStringField(15, ""),
          encodeBoolField(55, value),
        ]),
      )
      expect(decodeExecServerMessage(encoded)).toEqual(message)
    }
  })

  it("validates then ignores field 55 on request-context and MCP variants", () => {
    // Given
    const cases = [
      {
        wire: concatBytes([encodeBytesField(10, new Uint8Array()), encodeBoolField(55, false)]),
        encoded: concatBytes([
          encodeInt32Field(1, 0),
          encodeBytesField(10, new Uint8Array()),
          encodeStringField(15, ""),
        ]),
      },
      {
        wire: concatBytes([encodeBytesField(11, new Uint8Array()), encodeBoolField(55, true)]),
        encoded: concatBytes([
          encodeInt32Field(1, 0),
          encodeBytesField(11, new Uint8Array()),
          encodeStringField(15, ""),
        ]),
      },
    ]

    // When
    const messages = cases.map(({ wire }) => decodeExecServerMessage(wire))

    // Then
    expect(messages.map((message) => message.kind)).toEqual(["request-context-args", "mcp-args"])
    expect(
      messages.map((message) => Object.hasOwn(message, "acceptHookAdditionalContexts")),
    ).toEqual([false, false])
    for (const [index, message] of messages.entries()) {
      expect(encodeExecServerMessage(message)).toEqual(cases.at(index)?.encoded ?? new Uint8Array())
    }
  })

  it("keeps empty and identity-only frames malformed without field 55", () => {
    // Given
    const fixtures = [
      new Uint8Array(),
      concatBytes([encodeInt32Field(1, 1), encodeStringField(15, "identity")]),
    ]

    // When
    const decoders = fixtures.map((fixture) => (): void => {
      decodeExecServerMessage(fixture)
    })

    // Then
    for (const decode of decoders) expect(decode).toThrow(CursorProtocolError)
  })

  it("keeps malformed and drifted metadata-shaped frames strict", () => {
    // Given
    const cases = [
      {
        fixture: concatBytes([encodeBoolField(55, false), encodeBoolField(55, true)]),
        detail: "field 55 appears more than once",
      },
      { fixture: encodeInt32Field(55, 2), detail: "field 55 is not boolean" },
      { fixture: encodeBytesField(55, new Uint8Array()), detail: "field 55 expected wire 0" },
      {
        fixture: concatBytes([
          encodeBytesField(2, new Uint8Array()),
          encodeBytesField(7, new Uint8Array()),
          encodeBoolField(55, true),
        ]),
        detail: "expected one variant, received 2",
      },
      {
        fixture: concatBytes([encodeBoolField(55, true), encodeInt32Field(56, 1)]),
        detail: "field 56: unsupported protobuf field or variant",
      },
      {
        fixture: concatBytes([
          encodeInt32Field(1, 1),
          encodeInt32Field(1, 2),
          encodeBoolField(55, true),
        ]),
        detail: "field 1 appears more than once",
      },
      {
        fixture: concatBytes([
          encodeBytesField(19, new Uint8Array()),
          encodeBytesField(19, new Uint8Array()),
          encodeBoolField(55, true),
        ]),
        detail: "field 19 appears more than once",
      },
    ]

    // When
    const decoders = cases.map(({ fixture }) => (): void => {
      decodeExecServerMessage(fixture)
    })

    // Then
    for (const [index, decode] of decoders.entries()) {
      expect(decode).toThrow(cases.at(index)?.detail)
    }
  })
})

describe("cursorServerReplies", () => {
  it("does not reply to metadata exec messages", () => {
    // Given
    const exec = encodeBytesField(2, encodeBoolField(55, false))

    // When
    const replies = cursorServerReplies(exec, [])

    // Then
    expect(replies).toEqual([])
  })

  it("replies to request_context_args exec messages", () => {
    // Given
    const exec = encodeBytesField(
      2,
      concatBytes([
        encodeInt32Field(1, 3),
        encodeStringField(15, "exec-1"),
        encodeBytesField(10, new Uint8Array()),
      ]),
    )

    // When
    const replies = cursorServerReplies(exec, [
      { name: "read", description: "read", inputSchema: { type: "object" } },
    ])

    // Then
    expect(replies.length).toBe(1)
  })
})
