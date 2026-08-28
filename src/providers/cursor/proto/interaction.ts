// Derived from Rahularya01/pi-cursor proto/agent.proto InteractionUpdate fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
  type ProtoField,
} from "../proto-wire"
import { CursorProtocolDriftError, unreachableVariant } from "./errors"
import {
  assertKnownFields,
  collectDriftMetadata,
  encodeDriftFields,
  oneofField,
  optionalField,
  optionalString,
  optionalUint32,
  type ProtoDriftMetadata,
} from "./fields"
import { decodeToolUpdate, encodeToolUpdate, type ToolUpdate } from "./interaction-tool-update"
import { decodeTurnEndedUpdate, encodeTurnEndedUpdate } from "./interaction-turn-ended"
import { encodeUnknownField } from "./unknown-field"

export {
  decodeInteractionQuery,
  decodeInteractionResponse,
  encodeInteractionQuery,
  encodeInteractionResponse,
  type InteractionKind,
  type InteractionQuery,
  type InteractionResponse,
} from "./interaction-query"

const SEMANTIC_FIELDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const
const KNOWN_FIELDS = [...SEMANTIC_FIELDS, 25] as const

type SemanticInteractionUpdateBody =
  | { readonly kind: "text-delta"; readonly text: string }
  | ({ readonly kind: "tool-call-started" } & ToolUpdate)
  | ({ readonly kind: "tool-call-completed" } & ToolUpdate)
  | { readonly kind: "thinking-delta"; readonly text: string }
  | { readonly kind: "thinking-completed"; readonly payload: Uint8Array }
  | { readonly kind: "user-message-appended"; readonly payload: Uint8Array }
  | { readonly kind: "partial-tool-call"; readonly payload: Uint8Array }
  | { readonly kind: "token-delta"; readonly tokens: number }
  | { readonly kind: "summary"; readonly payload: Uint8Array }
  | { readonly kind: "summary-started"; readonly payload: Uint8Array }
  | { readonly kind: "summary-completed"; readonly payload: Uint8Array }
  | { readonly kind: "shell-output-delta"; readonly payload: Uint8Array }
  | { readonly kind: "heartbeat" }
  | ReturnType<typeof decodeTurnEndedUpdate>
  | { readonly kind: "tool-call-delta"; readonly payload: Uint8Array }
  | { readonly kind: "step-started"; readonly payload: Uint8Array }
  | { readonly kind: "step-completed"; readonly payload: Uint8Array }

export type Field25Telemetry = {
  readonly placement: "before-semantic" | "after-semantic"
  readonly payload: Uint8Array
}

type SemanticInteractionUpdate = SemanticInteractionUpdateBody & {
  readonly drift?: ProtoDriftMetadata
  readonly field25Telemetry?: Field25Telemetry
}

export type InteractionUpdate =
  | SemanticInteractionUpdate
  | { readonly kind: "field-25"; readonly payload: Uint8Array; readonly drift?: ProtoDriftMetadata }

type TextUpdate = {
  readonly text: string
  readonly drift?: ProtoDriftMetadata
}

function decodeTextUpdate(bytes: Uint8Array, context: string): TextUpdate {
  const fields = decodeFieldsStrict(bytes, { context })
  const drift = collectDriftMetadata(fields, [1])
  return {
    text: optionalString(fields, { context, field: 1, wire: 2 }) ?? "",
    ...(drift === undefined ? {} : { drift }),
  }
}

function encodeTextUpdate(field: number, update: TextUpdate): Uint8Array {
  return encodeBytesField(
    field,
    concatBytes([
      ...(update.text === "" ? [] : [encodeStringField(1, update.text)]),
      encodeDriftFields(update.drift),
    ]),
  )
}

function assertEmptyUpdate(bytes: Uint8Array, context: string): void {
  assertKnownFields(decodeFieldsStrict(bytes, { context }), [], context)
}

function decodeSemanticInteractionUpdate(update: ProtoField): SemanticInteractionUpdateBody {
  switch (update.field) {
    case 1:
      return { kind: "text-delta", ...decodeTextUpdate(update.bytes, "TextDeltaUpdate") }
    case 2:
      return {
        kind: "tool-call-started",
        ...decodeToolUpdate(update.bytes, "ToolCallStartedUpdate"),
      }
    case 3:
      return {
        kind: "tool-call-completed",
        ...decodeToolUpdate(update.bytes, "ToolCallCompletedUpdate"),
      }
    case 4:
      return { kind: "thinking-delta", ...decodeTextUpdate(update.bytes, "ThinkingDeltaUpdate") }
    case 5:
      return { kind: "thinking-completed", payload: update.bytes }
    case 6:
      return { kind: "user-message-appended", payload: update.bytes }
    case 7:
      return { kind: "partial-tool-call", payload: update.bytes }
    case 8: {
      const tokenContext = "TokenDeltaUpdate"
      const tokenFields = decodeFieldsStrict(update.bytes, { context: tokenContext })
      assertKnownFields(tokenFields, [1], tokenContext)
      return {
        kind: "token-delta",
        tokens: optionalUint32(tokenFields, { context: tokenContext, field: 1, wire: 0 }) ?? 0,
      }
    }
    case 9:
      return { kind: "summary", payload: update.bytes }
    case 10:
      return { kind: "summary-started", payload: update.bytes }
    case 11:
      return { kind: "summary-completed", payload: update.bytes }
    case 12:
      return { kind: "shell-output-delta", payload: update.bytes }
    case 13:
      assertEmptyUpdate(update.bytes, "HeartbeatUpdate")
      return { kind: "heartbeat" }
    case 14:
      return decodeTurnEndedUpdate(update.bytes)
    case 15:
      return { kind: "tool-call-delta", payload: update.bytes }
    case 16:
      return { kind: "step-started", payload: update.bytes }
    case 17:
      return { kind: "step-completed", payload: update.bytes }
    default:
      throw new CursorProtocolDriftError("InteractionUpdate", update.field)
  }
}

export function decodeInteractionUpdate(bytes: Uint8Array): InteractionUpdate {
  const context = "InteractionUpdate"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, KNOWN_FIELDS, context)
  const field25 = optionalField(fields, { context, field: 25, wire: 0 })
  if (field25 !== undefined && fields.length === 1) {
    return { kind: "field-25", payload: field25.bytes }
  }
  const update = oneofField(fields, SEMANTIC_FIELDS, context)
  const semantic = decodeSemanticInteractionUpdate(update)
  if (field25 === undefined) {
    return semantic
  }
  return {
    ...semantic,
    field25Telemetry: {
      placement:
        fields.indexOf(field25) < fields.indexOf(update) ? "before-semantic" : "after-semantic",
      payload: field25.bytes,
    },
  }
}

function encodeSemanticInteractionUpdate(update: SemanticInteractionUpdate): Uint8Array {
  switch (update.kind) {
    case "text-delta":
      return encodeTextUpdate(1, update)
    case "tool-call-started":
      return encodeBytesField(2, encodeToolUpdate(update))
    case "tool-call-completed":
      return encodeBytesField(3, encodeToolUpdate(update))
    case "thinking-delta":
      return encodeTextUpdate(4, update)
    case "thinking-completed":
      return encodeBytesField(5, update.payload)
    case "user-message-appended":
      return encodeBytesField(6, update.payload)
    case "partial-tool-call":
      return encodeBytesField(7, update.payload)
    case "token-delta":
      return encodeBytesField(
        8,
        update.tokens === 0 ? new Uint8Array() : encodeInt32Field(1, update.tokens),
      )
    case "summary":
      return encodeBytesField(9, update.payload)
    case "summary-started":
      return encodeBytesField(10, update.payload)
    case "summary-completed":
      return encodeBytesField(11, update.payload)
    case "shell-output-delta":
      return encodeBytesField(12, update.payload)
    case "heartbeat":
      return encodeBytesField(13, new Uint8Array())
    case "turn-ended":
      return encodeBytesField(14, encodeTurnEndedUpdate(update))
    case "tool-call-delta":
      return encodeBytesField(15, update.payload)
    case "step-started":
      return encodeBytesField(16, update.payload)
    case "step-completed":
      return encodeBytesField(17, update.payload)
    default:
      return unreachableVariant(update, "SemanticInteractionUpdate")
  }
}

function encodeSemanticWithTelemetry(update: SemanticInteractionUpdate): Uint8Array {
  const semantic = encodeSemanticInteractionUpdate(update)
  const telemetry = update.field25Telemetry
  if (telemetry === undefined) {
    return semantic
  }
  const field25 = encodeUnknownField(25, 0, telemetry.payload)
  switch (telemetry.placement) {
    case "before-semantic":
      return concatBytes([field25, semantic])
    case "after-semantic":
      return concatBytes([semantic, field25])
    default:
      return unreachableVariant(telemetry.placement, "Field25TelemetryPlacement")
  }
}

export function encodeInteractionUpdate(update: InteractionUpdate): Uint8Array {
  switch (update.kind) {
    case "field-25":
      return encodeUnknownField(25, 0, update.payload)
    case "text-delta":
    case "tool-call-started":
    case "tool-call-completed":
    case "thinking-delta":
    case "thinking-completed":
    case "user-message-appended":
    case "partial-tool-call":
    case "token-delta":
    case "summary":
    case "summary-started":
    case "summary-completed":
    case "shell-output-delta":
    case "heartbeat":
    case "turn-ended":
    case "tool-call-delta":
    case "step-started":
    case "step-completed":
      return encodeSemanticWithTelemetry(update)
    default:
      return unreachableVariant(update, "InteractionUpdate")
  }
}
