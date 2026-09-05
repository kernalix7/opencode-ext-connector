// Derived from Rahularya01/pi-cursor proto/agent.proto AgentRunRequest. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBytesField,
  encodeStringField,
} from "../proto-wire.js"
import {
  type ConversationCheckpoint,
  decodeConversationCheckpoint,
  encodeConversationCheckpoint,
} from "./checkpoint.js"
import {
  type ConversationAction,
  decodeConversationAction,
  encodeConversationAction,
} from "./context.js"
import {
  assertKnownFields,
  optionalField,
  optionalString,
  repeatedFields,
  requiredField,
} from "./fields.js"
import { decodeMcpToolDefinition, encodeMcpToolDefinition, type McpToolDefinition } from "./mcp.js"
import { decodeRequestedModel, encodeRequestedModel, type RequestedModel } from "./model.js"

export type AgentRunRequest = {
  readonly conversationState: ConversationCheckpoint
  readonly action: ConversationAction
  readonly modelDetails?: Uint8Array
  readonly mcpTools: readonly McpToolDefinition[]
  readonly conversationId?: string
  readonly mcpFileSystemOptions?: Uint8Array
  readonly skillOptions?: Uint8Array
  readonly customSystemPrompt?: string
  readonly requestedModel?: RequestedModel
}

export function decodeMcpTools(bytes: Uint8Array): readonly McpToolDefinition[] {
  const context = "McpTools"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1], context)
  return repeatedFields(fields, { context, field: 1, wire: 2 }).map((entry) =>
    decodeMcpToolDefinition(entry.bytes),
  )
}

export function encodeMcpTools(tools: readonly McpToolDefinition[]): Uint8Array {
  return concatBytes(tools.map((tool) => encodeBytesField(1, encodeMcpToolDefinition(tool))))
}

function optionalOpaque(
  fields: ReturnType<typeof decodeFieldsStrict>,
  field: number,
  context: string,
): Uint8Array | undefined {
  const value = optionalField(fields, { context, field, wire: 2 })
  if (value === undefined) {
    return undefined
  }
  decodeFieldsStrict(value.bytes, { context: `${context} field ${field}` })
  return value.bytes
}

export function decodeAgentRunRequest(bytes: Uint8Array): AgentRunRequest {
  const context = "AgentRunRequest"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5, 6, 7, 8, 9], context)
  const modelDetails = optionalOpaque(fields, 3, context)
  const conversationId = optionalString(fields, { context, field: 5, wire: 2 })
  const mcpFileSystemOptions = optionalOpaque(fields, 6, context)
  const skillOptions = optionalOpaque(fields, 7, context)
  const customSystemPrompt = optionalString(fields, { context, field: 8, wire: 2 })
  const requestedModel = optionalField(fields, { context, field: 9, wire: 2 })
  return {
    conversationState: decodeConversationCheckpoint(
      requiredField(fields, { context, field: 1, wire: 2 }).bytes,
    ),
    action: decodeConversationAction(requiredField(fields, { context, field: 2, wire: 2 }).bytes),
    ...(modelDetails === undefined ? {} : { modelDetails }),
    mcpTools: decodeMcpTools(requiredField(fields, { context, field: 4, wire: 2 }).bytes),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(mcpFileSystemOptions === undefined ? {} : { mcpFileSystemOptions }),
    ...(skillOptions === undefined ? {} : { skillOptions }),
    ...(customSystemPrompt === undefined ? {} : { customSystemPrompt }),
    ...(requestedModel === undefined
      ? {}
      : { requestedModel: decodeRequestedModel(requestedModel.bytes) }),
  }
}

export function encodeAgentRunRequest(request: AgentRunRequest): Uint8Array {
  return concatBytes([
    encodeBytesField(1, encodeConversationCheckpoint(request.conversationState)),
    encodeBytesField(2, encodeConversationAction(request.action)),
    ...(request.modelDetails === undefined ? [] : [encodeBytesField(3, request.modelDetails)]),
    encodeBytesField(4, encodeMcpTools(request.mcpTools)),
    ...(request.conversationId === undefined ? [] : [encodeStringField(5, request.conversationId)]),
    ...(request.mcpFileSystemOptions === undefined
      ? []
      : [encodeBytesField(6, request.mcpFileSystemOptions)]),
    ...(request.skillOptions === undefined ? [] : [encodeBytesField(7, request.skillOptions)]),
    ...(request.customSystemPrompt === undefined
      ? []
      : [encodeStringField(8, request.customSystemPrompt)]),
    ...(request.requestedModel === undefined
      ? []
      : [encodeBytesField(9, encodeRequestedModel(request.requestedModel))]),
  ])
}
