import { describe, expect, it } from "bun:test"

import {
  CursorProtocolDriftError,
  CursorProtocolError,
} from "../../../../../src/providers/cursor/proto/errors"
import {
  decodeInteractionQuery,
  decodeInteractionResponse,
  decodeInteractionUpdate,
  encodeInteractionQuery,
  encodeInteractionResponse,
  encodeInteractionUpdate,
} from "../../../../../src/providers/cursor/proto/interaction"
import {
  decodeAgentServerMessage,
  encodeAgentServerMessage,
} from "../../../../../src/providers/cursor/proto/server"

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

const MCP_ARGS_FIXTURE = [
  ...stringField(1, "read"),
  ...bytesField(2, [...stringField(1, "path"), ...bytesField(2, stringField(3, "a.ts"))]),
  ...stringField(3, "call-1"),
  ...stringField(4, "opencode"),
  ...stringField(5, "read"),
]

const TEXT_UPDATE_FIXTURE = Uint8Array.from(bytesField(1, stringField(1, "hello")))
const TOOL_UPDATE_FIXTURE = Uint8Array.from(
  bytesField(2, [
    ...stringField(1, "call-1"),
    ...bytesField(2, bytesField(15, bytesField(1, MCP_ARGS_FIXTURE))),
    ...stringField(3, "model-call-1"),
  ]),
)
describe("Cursor interaction codecs", () => {
  it("round-trips text, thinking, token, heartbeat, and turn-ended updates", () => {
    // Given
    const fixtures = [
      TEXT_UPDATE_FIXTURE,
      Uint8Array.from(bytesField(4, stringField(1, "hmm"))),
      Uint8Array.from(bytesField(8, uintField(1, 12))),
      Uint8Array.from(bytesField(13, [])),
      Uint8Array.from(bytesField(14, [])),
    ]

    // When
    const updates = fixtures.map(decodeInteractionUpdate)

    // Then
    expect(updates.map((update) => update.kind)).toEqual([
      "text-delta",
      "thinking-delta",
      "token-delta",
      "heartbeat",
      "turn-ended",
    ])
    expect(updates.map(encodeInteractionUpdate)).toEqual(fixtures)
  })

  it("decodes MCP args from a tool-call-started update", () => {
    // Given
    const expectedCallId = "call-1"

    // When
    const update = decodeInteractionUpdate(TOOL_UPDATE_FIXTURE)

    // Then
    expect(update.kind).toBe("tool-call-started")
    if (update.kind === "tool-call-started") {
      expect(update.callId).toBe(expectedCallId)
      expect(update.args.args).toEqual({ path: "a.ts" })
    }
    expect(encodeInteractionUpdate(update)).toEqual(TOOL_UPDATE_FIXTURE)
  })

  it("rejects top-level InteractionUpdate field 26", () => {
    // Given
    const fixture = Uint8Array.from(bytesField(26, []))

    // When
    const decode = (): void => {
      decodeInteractionUpdate(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolDriftError)
    expect(decode).toThrow("InteractionUpdate: field 26")
  })

  it("rejects two semantic InteractionUpdate fields", () => {
    // Given
    const fixture = Uint8Array.from([
      ...bytesField(1, stringField(1, "text")),
      ...bytesField(4, stringField(1, "thinking")),
    ])

    // When
    const decode = (): void => {
      decodeInteractionUpdate(fixture)
    }

    // Then
    expect(decode).toThrow(CursorProtocolError)
    expect(decode).toThrow("InteractionUpdate: malformed")
  })

  it("identifies every pinned InteractionQuery and Response field", () => {
    // Given
    const fields = [2, 3, 4, 5, 6, 7, 8]
    const queryFixtures = fields.map((field) =>
      Uint8Array.from([...uintField(1, 21), ...bytesField(field, [])]),
    )
    const responseFixtures = fields.map((field) =>
      Uint8Array.from([...uintField(1, 22), ...bytesField(field, [])]),
    )

    // When
    const queries = queryFixtures.map(decodeInteractionQuery)
    const responses = responseFixtures.map(decodeInteractionResponse)

    // Then
    expect(queries.map((query) => query.kind)).toEqual([
      "web-search",
      "ask-question",
      "switch-mode",
      "exa-search",
      "exa-fetch",
      "create-plan",
      "setup-vm",
    ])
    expect(responses.map((response) => response.kind)).toEqual(queries.map((query) => query.kind))
    expect(queries.map(encodeInteractionQuery)).toEqual(queryFixtures)
    expect(responses.map(encodeInteractionResponse)).toEqual(responseFixtures)
  })
})

describe("AgentServerMessage strict boundary", () => {
  it("decodes fields 1/2/3/4/7 and preserves their exact fixture bytes", () => {
    // Given
    const exec = [
      ...uintField(1, 7),
      ...bytesField(11, MCP_ARGS_FIXTURE),
      ...stringField(15, "exec-1"),
    ]
    const checkpoint = [
      ...bytesField(1, [0xaa]),
      ...bytesField(8, [0xbb]),
      ...stringField(22, "pi"),
    ]
    const kv = [...uintField(1, 8), ...bytesField(2, bytesField(1, [0xcc]))]
    const query = [...uintField(1, 9), ...bytesField(2, [])]
    const fixtures = [
      Uint8Array.from(bytesField(1, TEXT_UPDATE_FIXTURE)),
      Uint8Array.from(bytesField(2, exec)),
      Uint8Array.from(bytesField(3, checkpoint)),
      Uint8Array.from(bytesField(4, kv)),
      Uint8Array.from(bytesField(7, query)),
    ]

    // When
    const messages = fixtures.map((fixture) => decodeAgentServerMessage(fixture))

    // Then
    expect(messages.map((message) => message.kind)).toEqual([
      "interaction-update",
      "exec-server-message",
      "conversation-checkpoint-update",
      "kv-server-message",
      "interaction-query",
    ])
    expect(messages.map(encodeAgentServerMessage)).toEqual(fixtures)
  })

  it("preserves repeated ConversationStateStructure field 21 payloads in order", () => {
    // Given
    const firstTrackedBranch = Uint8Array.from([0x08, 0x01])
    const secondTrackedBranch = Uint8Array.from([0x12, 0x01, 0x78])
    const checkpoint = [
      ...bytesField(21, firstTrackedBranch),
      ...bytesField(21, secondTrackedBranch),
    ]
    const fixture = Uint8Array.from(bytesField(3, checkpoint))

    // When
    const message = decodeAgentServerMessage(fixture)

    // Then
    expect(message.kind).toBe("conversation-checkpoint-update")
    if (message.kind !== "conversation-checkpoint-update") return
    expect(message.checkpoint.trackedGitRepoBranches).toEqual([
      firstTrackedBranch,
      secondTrackedBranch,
    ])
    expect(encodeAgentServerMessage(message)).toEqual(fixture)
  })

  it("returns typed protocol errors for wrong wire, truncation, and size", () => {
    // Given
    const wrongWire = Uint8Array.from([0x08, 0x01])
    const truncated = Uint8Array.from([0x0a, 0x02, 0x01])
    const valid = Uint8Array.from(bytesField(1, TEXT_UPDATE_FIXTURE))

    // When
    const actions = [
      (): void => {
        decodeAgentServerMessage(wrongWire)
      },
      (): void => {
        decodeAgentServerMessage(truncated)
      },
      (): void => {
        decodeAgentServerMessage(valid, { maxBytes: 2 })
      },
    ]

    // Then
    for (const action of actions) {
      expect(action).toThrow(CursorProtocolError)
    }
  })
})
