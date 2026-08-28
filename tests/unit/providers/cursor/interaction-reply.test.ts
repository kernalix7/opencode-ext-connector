import { describe, expect, it } from "bun:test"

import { createCursorBlobStore } from "../../../../src/providers/cursor/blob-store"
import { createCursorCheckpointStore } from "../../../../src/providers/cursor/checkpoint-store"
import { decodeConnectFramesStrict } from "../../../../src/providers/cursor/connect-frame"
import {
  assertKnownFields,
  oneofField,
  requiredField,
  requiredString,
} from "../../../../src/providers/cursor/proto/fields"
import type { InteractionResponse } from "../../../../src/providers/cursor/proto/interaction-query"
import { decodeAgentClientMessage } from "../../../../src/providers/cursor/proto/request"
import { decodeFieldsStrict } from "../../../../src/providers/cursor/proto-wire"
import { createCursorServerDispatcher } from "../../../../src/providers/cursor/server-dispatch"
import { parseCursorSessionId } from "../../../../src/providers/cursor/session-state"
import { FakeClock } from "../../../support/clock"

const REJECT_REASON =
  "Not available through the Pi Cursor provider. Use Pi tools (web_search, fetch, bash, etc.) instead."
const ASK_QUESTION_ERROR =
  "Interactive questions are not available in Pi. Continue with a reasonable default or ask the user in chat."
const CREATE_PLAN_ERROR =
  "Create-plan UI is not available in Pi. Write the plan with Pi file tools."

function createDispatcher() {
  const clock = new FakeClock()
  const blobStore = createCursorBlobStore({ clock, maxBytes: 1_024, maxEntries: 16, ttlMs: 100 })
  const checkpointStore = createCursorCheckpointStore({
    blobStore,
    clock,
    maxBytes: 1_024,
    maxEntries: 4,
    ttlMs: 100,
  })
  return createCursorServerDispatcher({
    blobStore,
    checkpointStore,
    sessionId: parseCursorSessionId("interaction-reply-session"),
    tools: [],
  })
}

function decodeInteractionReply(frame: Uint8Array): InteractionResponse {
  const connectFrame = decodeConnectFramesStrict(frame).at(0)
  if (connectFrame === undefined) throw new Error("fixture expected a reply frame")
  const message = decodeAgentClientMessage(connectFrame.bytes)
  switch (message.kind) {
    case "interaction-response":
      return message.response
    default:
      throw new Error(`fixture expected interaction response, received ${message.kind}`)
  }
}

function rejectedReason(payload: Uint8Array, context: string): string {
  const response = oneofField(decodeFieldsStrict(payload, { context }), [2], context)
  const rejection = decodeFieldsStrict(response.bytes, { context: `${context}.rejected` })
  return requiredString(rejection, { context: `${context}.rejected`, field: 1, wire: 2 })
}

function typedError(payload: Uint8Array, context: string): string {
  const result = requiredField(decodeFieldsStrict(payload, { context }), {
    context,
    field: 1,
    wire: 2,
  })
  const error = oneofField(
    decodeFieldsStrict(result.bytes, { context: `${context}.result` }),
    [2],
    `${context}.result`,
  )
  return requiredString(decodeFieldsStrict(error.bytes, { context: `${context}.error` }), {
    context: `${context}.error`,
    field: 1,
    wire: 2,
  })
}

describe("Cursor interaction replies", () => {
  const rejected = ["web-search", "exa-search", "exa-fetch", "switch-mode", "field-9"] as const

  for (const kind of rejected) {
    it(`encodes a typed rejection for ${kind}`, () => {
      // Given
      const dispatcher = createDispatcher()

      // When
      const result = dispatcher.dispatch({
        kind: "interaction-query",
        query: { kind, id: 41, payload: new Uint8Array() },
      })

      // Then
      expect(result.outcome).toEqual({ kind: "interaction-replied", id: 41, action: "rejected" })
      const response = decodeInteractionReply(result.replyFrames[0] ?? new Uint8Array())
      expect(response.kind).toBe(kind)
      expect(response.id).toBe(41)
      expect(rejectedReason(response.payload, `InteractionResponse.${kind}`)).toBe(REJECT_REASON)
    })
  }

  it("encodes the ask-question typed error branch", () => {
    // Given
    const dispatcher = createDispatcher()

    // When
    const result = dispatcher.dispatch({
      kind: "interaction-query",
      query: { kind: "ask-question", id: 42, payload: new Uint8Array() },
    })

    // Then
    expect(result.outcome).toEqual({ kind: "interaction-replied", id: 42, action: "rejected" })
    const response = decodeInteractionReply(result.replyFrames[0] ?? new Uint8Array())
    expect(response.kind).toBe("ask-question")
    expect(response.id).toBe(42)
    expect(typedError(response.payload, "AskQuestionInteractionResponse")).toBe(ASK_QUESTION_ERROR)
  })

  it("encodes the create-plan typed error branch", () => {
    // Given
    const dispatcher = createDispatcher()

    // When
    const result = dispatcher.dispatch({
      kind: "interaction-query",
      query: { kind: "create-plan", id: 43, payload: new Uint8Array() },
    })

    // Then
    expect(result.outcome).toEqual({ kind: "interaction-replied", id: 43, action: "rejected" })
    const response = decodeInteractionReply(result.replyFrames[0] ?? new Uint8Array())
    expect(response.kind).toBe("create-plan")
    expect(response.id).toBe(43)
    expect(typedError(response.payload, "CreatePlanRequestResponse")).toBe(CREATE_PLAN_ERROR)
  })

  it("encodes the setup-vm typed success branch", () => {
    // Given
    const dispatcher = createDispatcher()

    // When
    const result = dispatcher.dispatch({
      kind: "interaction-query",
      query: { kind: "setup-vm", id: 44, payload: new Uint8Array() },
    })

    // Then
    expect(result.outcome).toEqual({ kind: "interaction-replied", id: 44, action: "acked" })
    const response = decodeInteractionReply(result.replyFrames[0] ?? new Uint8Array())
    expect(response.kind).toBe("setup-vm")
    expect(response.id).toBe(44)
    const resultField = oneofField(
      decodeFieldsStrict(response.payload, { context: "SetupVmEnvironmentResult" }),
      [1],
      "SetupVmEnvironmentResult",
    )
    assertKnownFields(
      decodeFieldsStrict(resultField.bytes, { context: "SetupVmEnvironmentSuccess" }),
      [],
      "SetupVmEnvironmentSuccess",
    )
  })
})
