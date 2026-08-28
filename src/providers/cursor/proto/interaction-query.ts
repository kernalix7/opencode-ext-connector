// Derived from Rahularya01/pi-cursor proto/agent.proto InteractionQuery/Response. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { concatBytes, decodeFieldsStrict, encodeBytesField, encodeInt32Field } from "../proto-wire"
import { CursorProtocolDriftError, unreachableVariant } from "./errors"
import { assertKnownFields, oneofField, requiredUint32 } from "./fields"

export type InteractionKind =
  | "web-search"
  | "ask-question"
  | "switch-mode"
  | "exa-search"
  | "exa-fetch"
  | "create-plan"
  | "setup-vm"
  | "field-9"

export type InteractionQuery = {
  readonly kind: InteractionKind
  readonly id: number
  readonly payload: Uint8Array
}

export type InteractionResponse = {
  readonly kind: InteractionKind
  readonly id: number
  readonly payload: Uint8Array
}

function kindForField(field: number, context: string): InteractionKind {
  switch (field) {
    case 2:
      return "web-search"
    case 3:
      return "ask-question"
    case 4:
      return "switch-mode"
    case 5:
      return "exa-search"
    case 6:
      return "exa-fetch"
    case 7:
      return "create-plan"
    case 8:
      return "setup-vm"
    case 9:
      return "field-9"
    default:
      throw new CursorProtocolDriftError(context, field)
  }
}

function fieldForKind(kind: InteractionKind): number {
  switch (kind) {
    case "web-search":
      return 2
    case "ask-question":
      return 3
    case "switch-mode":
      return 4
    case "exa-search":
      return 5
    case "exa-fetch":
      return 6
    case "create-plan":
      return 7
    case "setup-vm":
      return 8
    case "field-9":
      return 9
    default:
      return unreachableVariant(kind, "InteractionKind")
  }
}

function decodeInteraction(
  bytes: Uint8Array,
  context: string,
): {
  readonly kind: InteractionKind
  readonly id: number
  readonly payload: Uint8Array
} {
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5, 6, 7, 8, 9], context)
  const message = oneofField(fields, [2, 3, 4, 5, 6, 7, 8, 9], context)
  const kind = kindForField(message.field, context)
  decodeFieldsStrict(message.bytes, { context: `${context}.${kind}` })
  return {
    kind,
    id: requiredUint32(fields, { context, field: 1, wire: 0 }),
    payload: message.bytes,
  }
}

function encodeInteraction(message: InteractionQuery | InteractionResponse): Uint8Array {
  return concatBytes([
    encodeInt32Field(1, message.id),
    encodeBytesField(fieldForKind(message.kind), message.payload),
  ])
}

export function decodeInteractionQuery(bytes: Uint8Array): InteractionQuery {
  return decodeInteraction(bytes, "InteractionQuery")
}

export function encodeInteractionQuery(query: InteractionQuery): Uint8Array {
  return encodeInteraction(query)
}

export function decodeInteractionResponse(bytes: Uint8Array): InteractionResponse {
  return decodeInteraction(bytes, "InteractionResponse")
}

export function encodeInteractionResponse(response: InteractionResponse): Uint8Array {
  return encodeInteraction(response)
}
