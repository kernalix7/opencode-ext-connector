// Derived from Rahularya01/pi-cursor src/stream/interaction-query.ts. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { unreachableVariant } from "./proto/errors.js"
import type { InteractionQuery, InteractionResponse } from "./proto/interaction-query.js"
import { encodeBytesField, encodeStringField } from "./proto-wire.js"

const REJECT_REASON =
  "Not available through the Pi Cursor provider. Use Pi tools (web_search, fetch, bash, etc.) instead."
const ASK_QUESTION_ERROR =
  "Interactive questions are not available in Pi. Continue with a reasonable default or ask the user in chat."
const CREATE_PLAN_ERROR =
  "Create-plan UI is not available in Pi. Write the plan with Pi file tools."

export type CursorInteractionReply = {
  readonly action: "acked" | "rejected"
  readonly response: InteractionResponse
}

function rejectionPayload(): Uint8Array {
  return encodeBytesField(2, encodeStringField(1, REJECT_REASON))
}

function askQuestionErrorPayload(): Uint8Array {
  return encodeBytesField(1, encodeBytesField(2, encodeStringField(1, ASK_QUESTION_ERROR)))
}

function createPlanErrorPayload(): Uint8Array {
  return encodeBytesField(1, encodeBytesField(2, encodeStringField(1, CREATE_PLAN_ERROR)))
}

function setupVmSuccessPayload(): Uint8Array {
  return encodeBytesField(1, new Uint8Array())
}

function rejectedResponse(query: InteractionQuery): CursorInteractionReply {
  return {
    action: "rejected",
    response: { kind: query.kind, id: query.id, payload: rejectionPayload() },
  }
}

export function buildCursorInteractionReply(query: InteractionQuery): CursorInteractionReply {
  switch (query.kind) {
    case "web-search":
    case "switch-mode":
    case "exa-search":
    case "exa-fetch":
    case "field-9":
      return rejectedResponse(query)
    case "ask-question":
      return {
        action: "rejected",
        response: { kind: query.kind, id: query.id, payload: askQuestionErrorPayload() },
      }
    case "create-plan":
      return {
        action: "rejected",
        response: { kind: query.kind, id: query.id, payload: createPlanErrorPayload() },
      }
    case "setup-vm":
      return {
        action: "acked",
        response: { kind: query.kind, id: query.id, payload: setupVmSuccessPayload() },
      }
    default:
      return unreachableVariant(query.kind, "InteractionQuery kind")
  }
}
