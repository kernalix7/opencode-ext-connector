import { describe, expect, it } from "bun:test"
import {
  decodeConversationCheckpoint,
  encodeConversationCheckpoint,
} from "../../../../../src/providers/cursor/proto/checkpoint"
import {
  type ConversationAction,
  decodeConversationAction,
  decodeSelectedContext,
  encodeConversationAction,
  encodeSelectedContext,
  type SelectedContext,
} from "../../../../../src/providers/cursor/proto/context"
import {
  decodeRequestedModel,
  encodeRequestedModel,
} from "../../../../../src/providers/cursor/proto/model"
import {
  decodeAgentClientMessage,
  decodeAgentRunRequest,
  encodeAgentClientMessage,
  encodeAgentRunRequest,
} from "../../../../../src/providers/cursor/proto/request"
import {
  AGENT_CLIENT_CONTROL_FIXTURE,
  CONVERSATION_ACTION_FIXTURES,
  SELECTED_CONTEXT_WITH_OMITTED_PATH_FIXTURE,
} from "./static-fixtures"

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

const REQUESTED_MODEL_FIXTURE = Uint8Array.from([
  ...stringField(1, "composer-1"),
  ...uintField(2, 1),
  ...bytesField(3, [...stringField(1, "reasoning"), ...stringField(2, "high")]),
])

const CHECKPOINT_FIXTURE = Uint8Array.from([
  ...bytesField(1, [0xaa]),
  ...bytesField(8, [0xbb]),
  ...stringField(9, "file:///w"),
  ...uintField(10, 1),
  ...uintField(17, 2),
  ...stringField(18, "src/index.ts"),
  ...stringField(22, "pi"),
  0xd0,
  0x01,
  0x81,
  0x00,
])

const SELECTED_CONTEXT_FIXTURE = Uint8Array.from([
  ...bytesField(1, [
    ...bytesField(8, [0xde, 0xad]),
    ...stringField(2, "img"),
    ...stringField(3, "/a.png"),
    ...stringField(7, "image/png"),
  ]),
  ...stringField(3, "hint"),
])

const ACTION_FIXTURE = Uint8Array.from(
  bytesField(
    1,
    bytesField(1, [
      ...stringField(1, "hello"),
      ...stringField(2, "m-1"),
      ...bytesField(3, SELECTED_CONTEXT_FIXTURE),
      ...uintField(4, 1),
      ...bytesField(10, [0xcc]),
      ...stringField(17, "c-1"),
    ]),
  ),
)

const RUN_FIXTURE = Uint8Array.from([
  ...bytesField(1, CHECKPOINT_FIXTURE),
  ...bytesField(2, ACTION_FIXTURE),
  ...bytesField(3, stringField(1, "legacy")),
  ...bytesField(4, []),
  ...stringField(5, "conv-1"),
  ...bytesField(6, []),
  ...bytesField(7, []),
  ...stringField(8, "system"),
  ...bytesField(9, REQUESTED_MODEL_FIXTURE),
])

describe("Cursor request value codecs", () => {
  it("decodes and re-encodes requested model fields 1/2/3", () => {
    // Given
    const expected = {
      modelId: "composer-1",
      maxMode: true,
      parameters: [{ id: "reasoning", value: "high" }],
    }

    // When
    const decoded = decodeRequestedModel(REQUESTED_MODEL_FIXTURE)

    // Then
    expect(decoded).toEqual(expected)
    expect(encodeRequestedModel(expected)).toEqual(REQUESTED_MODEL_FIXTURE)
  })

  it("applies proto3 defaults when RequestedModel scalars are omitted", () => {
    // Given
    const fixture = new Uint8Array()

    // When
    const decoded = decodeRequestedModel(fixture)

    // Then
    expect(decoded).toEqual({ modelId: "", maxMode: false, parameters: [] })
    expect(encodeRequestedModel(decoded)).toEqual(fixture)
  })

  it("applies proto3 defaults when RequestedModel parameter scalars are omitted", () => {
    // Given
    const fixture = Uint8Array.from(bytesField(3, []))

    // When
    const decoded = decodeRequestedModel(fixture)

    // Then
    expect(decoded.parameters).toEqual([{ id: "", value: "" }])
    expect(encodeRequestedModel(decoded)).toEqual(fixture)
  })

  it("decodes selected image data and extra context with pinned fields", () => {
    // Given
    const expected: SelectedContext = {
      selectedImages: [
        {
          uuid: "img",
          path: "/a.png",
          mimeType: "image/png",
          data: { kind: "data", bytes: Uint8Array.from([0xde, 0xad]) },
        },
      ],
      extraContext: ["hint"],
    }

    // When
    const decoded = decodeSelectedContext(SELECTED_CONTEXT_FIXTURE)

    // Then
    expect(decoded).toEqual(expected)
    expect(encodeSelectedContext(expected)).toEqual(SELECTED_CONTEXT_FIXTURE)
  })

  it("decodes the minimum user-message conversation action", () => {
    // Given
    const expectedKind = "user-message"

    // When
    const decoded = decodeConversationAction(ACTION_FIXTURE)

    // Then
    expect(decoded.kind).toBe(expectedKind)
    expect(encodeConversationAction(decoded)).toEqual(ACTION_FIXTURE)
  })

  it("decodes and re-encodes a checkpoint without dropping blob references", () => {
    // Given
    const expectedClient = "pi"

    // When
    const checkpoint = decodeConversationCheckpoint(CHECKPOINT_FIXTURE)

    // Then
    expect(checkpoint.clientName).toBe(expectedClient)
    expect(checkpoint.conversationStartedTimestampMs).toEqual(Uint8Array.from([0x81, 0x00]))
    expect(checkpoint.rootPromptMessageBlobIds).toEqual([Uint8Array.from([0xaa])])
    expect(checkpoint.turnBlobIds).toEqual([Uint8Array.from([0xbb])])
    expect(encodeConversationCheckpoint(checkpoint)).toEqual(CHECKPOINT_FIXTURE)
  })

  it("decodes all pinned AgentRunRequest fields 1 through 9", () => {
    // Given
    const expectedConversationId = "conv-1"

    // When
    const request = decodeAgentRunRequest(RUN_FIXTURE)

    // Then
    expect(request.conversationId).toBe(expectedConversationId)
    expect(request.requestedModel?.modelId).toBe("composer-1")
    expect(request.customSystemPrompt).toBe("system")
    expect(encodeAgentRunRequest(request)).toEqual(RUN_FIXTURE)
  })
})

describe("AgentClientMessage strict variants", () => {
  it("decodes fields 1/2/3/4/6/7/8 into readonly discriminants", () => {
    // Given
    const exec = [
      ...uintField(1, 7),
      ...bytesField(11, bytesField(2, stringField(1, "failed"))),
      ...stringField(15, "exec-1"),
    ]
    const kv = [...uintField(1, 8), ...bytesField(2, bytesField(1, [0xaa]))]
    const interaction = [
      ...uintField(1, 9),
      ...bytesField(2, bytesField(2, stringField(1, "blocked"))),
    ]
    const fixtures = [
      bytesField(1, RUN_FIXTURE),
      bytesField(2, exec),
      bytesField(3, kv),
      bytesField(4, ACTION_FIXTURE),
      bytesField(6, interaction),
      bytesField(7, []),
      bytesField(8, []),
    ]

    // When
    const kinds = fixtures.map((fixture) => decodeAgentClientMessage(Uint8Array.from(fixture)).kind)

    // Then
    expect(kinds).toEqual([
      "run-request",
      "exec-client-message",
      "kv-client-message",
      "conversation-action",
      "interaction-response",
      "client-heartbeat",
      "prewarm-request",
    ])
  })

  it("decodes pinned exec-client-control field 5 instead of treating it as drift", () => {
    // Given
    const expectedId = 7

    // When
    const message = decodeAgentClientMessage(AGENT_CLIENT_CONTROL_FIXTURE)

    // Then
    expect(message.kind).toBe("exec-client-control")
    if (message.kind === "exec-client-control") {
      expect(message.control).toEqual({ kind: "heartbeat", id: expectedId })
    }
    expect(encodeAgentClientMessage(message)).toEqual(AGENT_CLIENT_CONTROL_FIXTURE)
  })

  it("models every pinned ConversationAction field and preserves opaque payloads", () => {
    // Given
    const expectedKinds: readonly ConversationAction["kind"][] = [
      "user-message",
      "resume",
      "cancel",
      "summarize",
      "shell-command",
      "start-plan",
      "execute-plan",
      "async-ask-question-completion",
    ]

    // When
    const actions = CONVERSATION_ACTION_FIXTURES.map(decodeConversationAction)

    // Then
    expect(actions.map((action) => action.kind)).toEqual([...expectedKinds])
    expect(actions.map(encodeConversationAction)).toEqual([...CONVERSATION_ACTION_FIXTURES])
  })

  it("applies the proto3 empty-string default when SelectedImage.path is omitted", () => {
    // Given
    const expectedPath = ""

    // When
    const context = decodeSelectedContext(SELECTED_CONTEXT_WITH_OMITTED_PATH_FIXTURE)

    // Then
    expect(context.selectedImages.at(0)?.path).toBe(expectedPath)
    expect(encodeSelectedContext(context)).toEqual(SELECTED_CONTEXT_WITH_OMITTED_PATH_FIXTURE)
  })
})
