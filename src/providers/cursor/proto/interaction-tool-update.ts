// Derived from Rahularya01/pi-cursor proto/agent.proto InteractionUpdate fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { concatBytes, decodeFieldsStrict, encodeBytesField, encodeStringField } from "../proto-wire"
import {
  assertKnownFields,
  oneofField,
  optionalField,
  requiredField,
  requiredString,
} from "./fields"
import {
  decodeMcpArgs,
  decodeMcpToolResult,
  encodeMcpArgs,
  encodeMcpToolResult,
  type McpArgs,
  type McpToolResult,
} from "./mcp"

export type ToolUpdate = {
  readonly callId: string
  readonly modelCallId: string
  readonly args: McpArgs
  readonly result?: McpToolResult
  readonly rawPayload?: Uint8Array
}

function opaqueToolUpdate(bytes: Uint8Array): ToolUpdate {
  return {
    callId: "",
    modelCallId: "",
    args: { name: "", args: {}, toolCallId: "", providerIdentifier: "", toolName: "" },
    rawPayload: bytes,
  }
}

export function decodeToolUpdate(bytes: Uint8Array, context: string): ToolUpdate {
  if (bytes.length === 0) {
    return opaqueToolUpdate(bytes)
  }
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3], context)
  const callIdField = optionalField(fields, { context, field: 1, wire: 2 })
  const modelCallIdField = optionalField(fields, { context, field: 3, wire: 2 })
  if (callIdField === undefined || modelCallIdField === undefined) {
    return opaqueToolUpdate(bytes)
  }
  const toolCallContext = "ToolCall"
  const toolCall = decodeFieldsStrict(requiredField(fields, { context, field: 2, wire: 2 }).bytes, {
    context: toolCallContext,
  })
  assertKnownFields(toolCall, [15], toolCallContext)
  const mcpContext = "McpToolCall"
  const mcp = decodeFieldsStrict(oneofField(toolCall, [15], toolCallContext).bytes, {
    context: mcpContext,
  })
  assertKnownFields(mcp, [1, 2], mcpContext)
  const result = optionalField(mcp, { context: mcpContext, field: 2, wire: 2 })
  return {
    callId: requiredString(fields, { context, field: 1, wire: 2 }),
    modelCallId: requiredString(fields, { context, field: 3, wire: 2 }),
    args: decodeMcpArgs(requiredField(mcp, { context: mcpContext, field: 1, wire: 2 }).bytes),
    ...(result === undefined ? {} : { result: decodeMcpToolResult(result.bytes) }),
  }
}

export function encodeToolUpdate(update: ToolUpdate): Uint8Array {
  if (update.rawPayload !== undefined) {
    return update.rawPayload
  }
  const mcp = concatBytes([
    encodeBytesField(1, encodeMcpArgs(update.args)),
    ...(update.result === undefined
      ? []
      : [encodeBytesField(2, encodeMcpToolResult(update.result))]),
  ])
  return concatBytes([
    encodeStringField(1, update.callId),
    encodeBytesField(2, encodeBytesField(15, mcp)),
    encodeStringField(3, update.modelCallId),
  ])
}
