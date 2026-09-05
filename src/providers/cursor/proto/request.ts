// Derived from Rahularya01/pi-cursor proto/agent.proto AgentClientMessage. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBytesField,
  type ProtoDecodeOptions,
} from "../proto-wire.js"
import {
  type ConversationAction,
  decodeConversationAction,
  encodeConversationAction,
} from "./context.js"
import { CursorProtocolDriftError, unreachableVariant } from "./errors.js"
import { decodeExecClientMessage, type ExecClientMessage, encodeExecClientMessage } from "./exec.js"
import {
  decodeExecClientControl,
  type ExecClientControl,
  encodeExecClientControl,
} from "./exec-control.js"
import {
  assertKnownFields,
  collectDriftMetadata,
  encodeDriftFields,
  oneofField,
  type ProtoDriftMetadata,
} from "./fields.js"
import {
  decodeInteractionResponse,
  encodeInteractionResponse,
  type InteractionResponse,
} from "./interaction-query.js"
import { decodeKvClientMessage, encodeKvClientMessage, type KvClientMessage } from "./kv.js"
import { decodePrewarmRequest, encodePrewarmRequest, type PrewarmRequest } from "./prewarm.js"
import {
  type AgentRunRequest,
  decodeAgentRunRequest,
  encodeAgentRunRequest,
} from "./run-request.js"

export type { PrewarmRequest } from "./prewarm.js"
export {
  type AgentRunRequest,
  decodeAgentRunRequest,
  encodeAgentRunRequest,
} from "./run-request.js"

export type AgentClientMessage = (
  | { readonly kind: "run-request"; readonly request: AgentRunRequest }
  | { readonly kind: "exec-client-message"; readonly message: ExecClientMessage }
  | { readonly kind: "exec-client-control"; readonly control: ExecClientControl }
  | { readonly kind: "kv-client-message"; readonly message: KvClientMessage }
  | { readonly kind: "conversation-action"; readonly action: ConversationAction }
  | { readonly kind: "interaction-response"; readonly response: InteractionResponse }
  | { readonly kind: "client-heartbeat" }
  | { readonly kind: "prewarm-request"; readonly request: PrewarmRequest }
  | {
      readonly kind: "unknown-oneof"
      readonly field: number
      readonly payload: Uint8Array
      readonly drift: ProtoDriftMetadata
    }
) & { readonly drift?: ProtoDriftMetadata }

export function decodeAgentClientMessage(
  bytes: Uint8Array,
  options: ProtoDecodeOptions = {},
): AgentClientMessage {
  const context = "AgentClientMessage"
  const fields = decodeFieldsStrict(bytes, { ...options, context })
  const allowed = [1, 2, 3, 4, 5, 6, 7, 8]
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
  const drift = collectDriftMetadata(fields, allowed)
  const message = oneofField(fields, allowed, context)
  switch (message.field) {
    case 1:
      return {
        kind: "run-request",
        request: decodeAgentRunRequest(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 2:
      return {
        kind: "exec-client-message",
        message: decodeExecClientMessage(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 3:
      return {
        kind: "kv-client-message",
        message: decodeKvClientMessage(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 4:
      return {
        kind: "conversation-action",
        action: decodeConversationAction(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 5:
      return {
        kind: "exec-client-control",
        control: decodeExecClientControl(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 6:
      return {
        kind: "interaction-response",
        response: decodeInteractionResponse(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    case 7:
      assertKnownFields(
        decodeFieldsStrict(message.bytes, { context: "ClientHeartbeat" }),
        [],
        "ClientHeartbeat",
      )
      return { kind: "client-heartbeat", ...(drift === undefined ? {} : { drift }) }
    case 8:
      return {
        kind: "prewarm-request",
        request: decodePrewarmRequest(message.bytes),
        ...(drift === undefined ? {} : { drift }),
      }
    default:
      throw new CursorProtocolDriftError(context, message.field)
  }
}

export function encodeAgentClientMessage(message: AgentClientMessage): Uint8Array {
  let encoded: Uint8Array
  switch (message.kind) {
    case "run-request":
      encoded = encodeBytesField(1, encodeAgentRunRequest(message.request))
      break
    case "exec-client-message":
      encoded = encodeBytesField(2, encodeExecClientMessage(message.message))
      break
    case "exec-client-control":
      encoded = encodeBytesField(5, encodeExecClientControl(message.control))
      break
    case "kv-client-message":
      encoded = encodeBytesField(3, encodeKvClientMessage(message.message))
      break
    case "conversation-action":
      encoded = encodeBytesField(4, encodeConversationAction(message.action))
      break
    case "interaction-response":
      encoded = encodeBytesField(6, encodeInteractionResponse(message.response))
      break
    case "client-heartbeat":
      encoded = encodeBytesField(7, new Uint8Array())
      break
    case "prewarm-request":
      encoded = encodeBytesField(8, encodePrewarmRequest(message.request))
      break
    case "unknown-oneof":
      return encodeBytesField(message.field, message.payload)
    default:
      return unreachableVariant(message, "AgentClientMessage")
  }
  return concatBytes([encoded, encodeDriftFields(message.drift)])
}
