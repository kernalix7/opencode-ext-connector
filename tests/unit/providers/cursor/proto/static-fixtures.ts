// Derived from Rahularya01/pi-cursor v1.4.26 generated descriptor and field-9 stream codec.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

export const PINNED_PI_CURSOR_VERSION: string = "1.4.26"
export const PINNED_AGENT_PROTO_SHA256: string =
  "0760b83d6a9a5ad3911aaa00a345b71bd1147178b667917fd17e5826661af47c"

function varint(value: bigint): readonly number[] {
  const bytes: number[] = []
  let remaining = value
  while (remaining > 0x7fn) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n))
    remaining >>= 7n
  }
  bytes.push(Number(remaining))
  return bytes
}

function bytesField(field: number, value: ArrayLike<number> & Iterable<number>): readonly number[] {
  return [...varint(BigInt((field << 3) | 2)), ...varint(BigInt(value.length)), ...value]
}

function uintField(field: number, value: bigint): readonly number[] {
  return [...varint(BigInt(field << 3)), ...varint(value)]
}

function stringField(field: number, value: string): readonly number[] {
  return bytesField(field, new TextEncoder().encode(value))
}

function interactionPayload(field: number): readonly number[] {
  switch (field) {
    case 1:
      return stringField(1, "text")
    case 2:
    case 3:
      return bytesField(2, bytesField(15, bytesField(1, [])))
    case 4:
      return stringField(1, "thinking")
    case 5:
      return uintField(1, 12n)
    case 6:
      return bytesField(1, [])
    case 8:
      return uintField(1, 7n)
    case 9:
      return stringField(1, "summary")
    case 16:
      return uintField(1, 0x8000000000000000n)
    case 17:
      return [...uintField(1, 0xffffffffffffffffn), ...uintField(2, 0x7fffffffffffffffn)]
    case 7:
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
    case 15:
      return []
    default:
      throw new RangeError(`unsupported fixture field ${field}`)
  }
}

export const AGENT_CLIENT_CONTROL_FIXTURE: Uint8Array = Uint8Array.from(
  bytesField(5, bytesField(3, uintField(1, 7n))),
)

export const AGENT_SERVER_CONTROL_FIXTURE: Uint8Array = Uint8Array.from(
  bytesField(5, bytesField(1, uintField(1, 8n))),
)

export const CONVERSATION_ACTION_FIXTURES: readonly Uint8Array[] = [
  Uint8Array.from(bytesField(1, [])),
  ...[2, 3, 4, 5, 6, 7, 8].map((field) => Uint8Array.from(bytesField(field, []))),
]

export const SELECTED_CONTEXT_WITH_OMITTED_PATH_FIXTURE: Uint8Array = Uint8Array.from(
  bytesField(1, [
    ...bytesField(8, [0xde, 0xad]),
    ...stringField(2, "image-id"),
    ...stringField(7, "image/png"),
  ]),
)

export const INTERACTION_UPDATE_FIXTURES: readonly Uint8Array[] = Array.from(
  { length: 17 },
  (_, index) => {
    const field = index + 1
    return Uint8Array.from(bytesField(field, interactionPayload(field)))
  },
)

export const INTERACTION_QUERY_FIELD_9_FIXTURE: Uint8Array = Uint8Array.from([
  ...uintField(1, 21n),
  ...bytesField(9, bytesField(1, [])),
])

export const INTERACTION_RESPONSE_FIELD_9_FIXTURE: Uint8Array = Uint8Array.from([
  ...uintField(1, 21n),
  ...bytesField(9, bytesField(2, stringField(1, "rejected"))),
])

const SPAN_CONTEXT_FIXTURE = [
  ...stringField(1, "trace"),
  ...stringField(2, "span"),
  ...uintField(3, 1n),
  ...stringField(4, "state"),
]

export const EXEC_SERVER_NATIVE_WITH_SPAN_FIXTURE: Uint8Array = Uint8Array.from([
  ...uintField(1, 3n),
  ...bytesField(2, []),
  ...stringField(15, "exec-native"),
  ...bytesField(19, SPAN_CONTEXT_FIXTURE),
])

export const EXEC_CLIENT_NATIVE_FIXTURE: Uint8Array = Uint8Array.from([
  ...uintField(1, 4n),
  ...bytesField(2, []),
  ...stringField(15, "exec-result"),
])

export const KV_SERVER_WITH_SPAN_FIXTURE: Uint8Array = Uint8Array.from([
  ...uintField(1, 5n),
  ...bytesField(2, bytesField(1, [0xaa])),
  ...bytesField(4, SPAN_CONTEXT_FIXTURE),
])

const OUTPUT_LOCATION_FIXTURE = [
  ...stringField(1, "/tmp/result.txt"),
  ...uintField(2, 0x20000000000001n),
  ...uintField(3, 42n),
]
const MCP_SUCCESS_WITH_LOCATION_FIXTURE = bytesField(1, [
  ...bytesField(
    1,
    bytesField(1, [...stringField(1, "ok"), ...bytesField(2, OUTPUT_LOCATION_FIXTURE)]),
  ),
  ...uintField(2, 0n),
])
const MCP_ARGS_FIXTURE = [
  ...stringField(1, "tool"),
  ...stringField(3, "call"),
  ...stringField(4, "provider"),
  ...stringField(5, "tool"),
]

export const EXEC_MCP_RESULT_WITH_LOCATION_FIXTURE: Uint8Array = Uint8Array.from(
  MCP_SUCCESS_WITH_LOCATION_FIXTURE,
)

export const INTERACTION_MCP_RESULT_WITH_LOCATION_FIXTURE: Uint8Array = Uint8Array.from(
  bytesField(3, [
    ...stringField(1, "call"),
    ...bytesField(
      2,
      bytesField(15, [
        ...bytesField(1, MCP_ARGS_FIXTURE),
        ...bytesField(2, MCP_SUCCESS_WITH_LOCATION_FIXTURE),
      ]),
    ),
    ...stringField(3, "model"),
  ]),
)

export const INTERACTION_MCP_UNKNOWN_RESULT_FIXTURE: Uint8Array = Uint8Array.from(
  bytesField(3, [
    ...stringField(1, "call"),
    ...bytesField(
      2,
      bytesField(15, [...bytesField(1, MCP_ARGS_FIXTURE), ...bytesField(2, bytesField(5, []))]),
    ),
    ...stringField(3, "model"),
  ]),
)

export const EXEC_MCP_TOOL_NOT_FOUND_FIXTURE: Uint8Array = Uint8Array.from(
  bytesField(5, stringField(1, "missing")),
)

export const SERVER_WITH_UNKNOWN_FIELD_FIXTURE: Uint8Array = Uint8Array.from([
  ...bytesField(1, bytesField(13, [])),
  ...bytesField(99, [0xaa]),
])

export const SERVER_UNKNOWN_ACTIVE_ONEOF_FIXTURE: Uint8Array = Uint8Array.from(
  bytesField(42, [0x08, 0x01]),
)

export const UINT64_OPAQUE_FIELD_FIXTURE: Uint8Array = Uint8Array.from(
  uintField(1, 0xffffffffffffffffn),
)
