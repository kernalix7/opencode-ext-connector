// Derived from Rahularya01/pi-cursor proto/agent.proto PrewarmRequest fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBoolField,
  encodeBytesField,
  encodeStringField,
} from "../proto-wire.js"
import {
  type ConversationCheckpoint,
  decodeConversationCheckpoint,
  encodeConversationCheckpoint,
} from "./checkpoint.js"
import { assertKnownFields, optionalBool, optionalField, optionalString } from "./fields.js"
import type { McpToolDefinition } from "./mcp.js"
import { decodeRequestedModel, encodeRequestedModel, type RequestedModel } from "./model.js"
import { decodeMcpTools, encodeMcpTools } from "./run-request.js"

export type PrewarmRequest = {
  readonly modelDetails?: Uint8Array
  readonly requestedModel?: RequestedModel
  readonly conversationId?: string
  readonly conversationState?: ConversationCheckpoint
  readonly mcpTools: readonly McpToolDefinition[]
  readonly mcpFileSystemOptions?: Uint8Array
  readonly bestOfNGroupId?: string
  readonly tryUseBestOfNPromotion?: boolean
  readonly customSystemPrompt?: string
}

function optionalOpaque(
  fields: ReturnType<typeof decodeFieldsStrict>,
  field: number,
  context: string,
): Uint8Array | undefined {
  const value = optionalField(fields, { context, field, wire: 2 })
  if (value !== undefined) {
    decodeFieldsStrict(value.bytes, { context: `${context} field ${field}` })
  }
  return value?.bytes
}

export function decodePrewarmRequest(bytes: Uint8Array): PrewarmRequest {
  const context = "PrewarmRequest"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5, 6, 7, 8, 9], context)
  const modelDetails = optionalOpaque(fields, 1, context)
  const requestedModel = optionalField(fields, { context, field: 9, wire: 2 })
  const conversationId = optionalString(fields, { context, field: 2, wire: 2 })
  const conversationState = optionalField(fields, { context, field: 3, wire: 2 })
  const mcpTools = optionalField(fields, { context, field: 4, wire: 2 })
  const mcpFileSystemOptions = optionalOpaque(fields, 5, context)
  const bestOfNGroupId = optionalString(fields, { context, field: 6, wire: 2 })
  const tryUseBestOfNPromotion = optionalBool(fields, { context, field: 7, wire: 0 })
  const customSystemPrompt = optionalString(fields, { context, field: 8, wire: 2 })
  return {
    ...(modelDetails === undefined ? {} : { modelDetails }),
    ...(requestedModel === undefined
      ? {}
      : { requestedModel: decodeRequestedModel(requestedModel.bytes) }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(conversationState === undefined
      ? {}
      : { conversationState: decodeConversationCheckpoint(conversationState.bytes) }),
    mcpTools: mcpTools === undefined ? [] : decodeMcpTools(mcpTools.bytes),
    ...(mcpFileSystemOptions === undefined ? {} : { mcpFileSystemOptions }),
    ...(bestOfNGroupId === undefined ? {} : { bestOfNGroupId }),
    ...(tryUseBestOfNPromotion === undefined ? {} : { tryUseBestOfNPromotion }),
    ...(customSystemPrompt === undefined ? {} : { customSystemPrompt }),
  }
}

export function encodePrewarmRequest(request: PrewarmRequest): Uint8Array {
  return concatBytes([
    ...(request.modelDetails === undefined ? [] : [encodeBytesField(1, request.modelDetails)]),
    ...(request.conversationId === undefined ? [] : [encodeStringField(2, request.conversationId)]),
    ...(request.conversationState === undefined
      ? []
      : [encodeBytesField(3, encodeConversationCheckpoint(request.conversationState))]),
    ...(request.mcpTools.length === 0
      ? []
      : [encodeBytesField(4, encodeMcpTools(request.mcpTools))]),
    ...(request.mcpFileSystemOptions === undefined
      ? []
      : [encodeBytesField(5, request.mcpFileSystemOptions)]),
    ...(request.bestOfNGroupId === undefined ? [] : [encodeStringField(6, request.bestOfNGroupId)]),
    ...(request.tryUseBestOfNPromotion === undefined
      ? []
      : [encodeBoolField(7, request.tryUseBestOfNPromotion)]),
    ...(request.customSystemPrompt === undefined
      ? []
      : [encodeStringField(8, request.customSystemPrompt)]),
    ...(request.requestedModel === undefined
      ? []
      : [encodeBytesField(9, encodeRequestedModel(request.requestedModel))]),
  ])
}
