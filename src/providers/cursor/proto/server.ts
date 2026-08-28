// Derived from Rahularya01/pi-cursor proto/agent.proto AgentServerMessage. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBytesField,
  type ProtoDecodeOptions,
} from "../proto-wire"
import {
  type ConversationCheckpoint,
  decodeConversationCheckpoint,
  encodeConversationCheckpoint,
} from "./checkpoint"
import { CursorProtocolDriftError, unreachableVariant } from "./errors"
import { decodeExecServerMessage, type ExecServerMessage, encodeExecServerMessage } from "./exec"
import {
  decodeExecServerControl,
  type ExecServerControl,
  encodeExecServerControl,
} from "./exec-control"
import {
  collectDriftMetadata,
  encodeDriftFields,
  oneofField,
  type ProtoDriftMetadata,
} from "./fields"
import {
  decodeInteractionQuery,
  decodeInteractionUpdate,
  encodeInteractionQuery,
  encodeInteractionUpdate,
  type InteractionQuery,
  type InteractionUpdate,
} from "./interaction"
import { decodeKvServerMessage, encodeKvServerMessage, type KvServerMessage } from "./kv"

export type AgentServerMessage = (
  | { readonly kind: "interaction-update"; readonly update: InteractionUpdate }
  | { readonly kind: "exec-server-message"; readonly message: ExecServerMessage }
  | { readonly kind: "exec-server-control"; readonly control: ExecServerControl }
  | {
      readonly kind: "conversation-checkpoint-update"
      readonly checkpoint: ConversationCheckpoint
    }
  | { readonly kind: "kv-server-message"; readonly message: KvServerMessage }
  | { readonly kind: "interaction-query"; readonly query: InteractionQuery }
  | {
      readonly kind: "unknown-oneof"
      readonly field: number
      readonly payload: Uint8Array
      readonly drift: ProtoDriftMetadata
    }
) & { readonly drift?: ProtoDriftMetadata }

export function decodeAgentServerMessage(
  bytes: Uint8Array,
  options: ProtoDecodeOptions = {},
): AgentServerMessage {
  const context = "AgentServerMessage"
  const fields = decodeFieldsStrict(bytes, { ...options, context })
  const allowed = [1, 2, 3, 4, 5, 7]
  const known = fields.filter((field) => allowed.includes(field.field))
  if (known.length === 0) {
    const message = oneofField(
      fields,
      fields.map((field) => field.field),
      context,
    )
    const drift = collectDriftMetadata(fields, allowed, true)
    if (drift === undefined) throw new CursorProtocolDriftError(context, message.field)
    return { kind: "unknown-oneof", field: message.field, payload: message.bytes, drift }
  }
  const message = oneofField(fields, allowed, context)
  const drift = collectDriftMetadata(fields, allowed)
  switch (message.field) {
    case 1:
      return {
        kind: "interaction-update",
        update: decodeInteractionUpdate(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 2:
      return {
        kind: "exec-server-message",
        message: decodeExecServerMessage(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 3:
      return {
        kind: "conversation-checkpoint-update",
        checkpoint: decodeConversationCheckpoint(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 4:
      return {
        kind: "kv-server-message",
        message: decodeKvServerMessage(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 5:
      return {
        kind: "exec-server-control",
        control: decodeExecServerControl(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 7:
      return {
        kind: "interaction-query",
        query: decodeInteractionQuery(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    default:
      throw new CursorProtocolDriftError(context, message.field)
  }
}

export function encodeAgentServerMessage(message: AgentServerMessage): Uint8Array {
  let encoded: Uint8Array
  switch (message.kind) {
    case "interaction-update":
      encoded = encodeBytesField(1, encodeInteractionUpdate(message.update))
      break
    case "exec-server-message":
      encoded = encodeBytesField(2, encodeExecServerMessage(message.message))
      break
    case "conversation-checkpoint-update":
      encoded = encodeBytesField(3, encodeConversationCheckpoint(message.checkpoint))
      break
    case "kv-server-message":
      encoded = encodeBytesField(4, encodeKvServerMessage(message.message))
      break
    case "exec-server-control":
      encoded = encodeBytesField(5, encodeExecServerControl(message.control))
      break
    case "interaction-query":
      encoded = encodeBytesField(7, encodeInteractionQuery(message.query))
      break
    case "unknown-oneof":
      return encodeBytesField(message.field, message.payload)
    default:
      return unreachableVariant(message, "AgentServerMessage")
  }
  return concatBytes([encoded, encodeDriftFields(message.drift)])
}
