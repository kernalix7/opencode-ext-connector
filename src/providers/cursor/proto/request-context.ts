// Derived from Rahularya01/pi-cursor proto/agent.proto request-context fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { concatBytes, decodeFieldsStrict, encodeBytesField, encodeStringField } from "../proto-wire"
import { CursorProtocolDriftError, unreachableVariant } from "./errors"
import { assertKnownFields, oneofField, repeatedFields, requiredString } from "./fields"
import { decodeMcpToolDefinition, encodeMcpToolDefinition, type McpToolDefinition } from "./mcp"

export type RequestContext = {
  readonly tools: readonly McpToolDefinition[]
}

export type RequestContextResult =
  | { readonly kind: "success"; readonly requestContext: RequestContext }
  | { readonly kind: "error"; readonly error: string }
  | { readonly kind: "rejected"; readonly reason: string }

function decodeRequestContext(bytes: Uint8Array): RequestContext {
  const context = "RequestContext"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [7], context)
  return {
    tools: repeatedFields(fields, { context, field: 7, wire: 2 }).map((entry) =>
      decodeMcpToolDefinition(entry.bytes),
    ),
  }
}

function encodeRequestContext(context: RequestContext): Uint8Array {
  return concatBytes(
    context.tools.map((tool) => encodeBytesField(7, encodeMcpToolDefinition(tool))),
  )
}

function decodeSingleString(bytes: Uint8Array, context: string): string {
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1], context)
  return requiredString(fields, { context, field: 1, wire: 2 })
}

export function decodeRequestContextResult(bytes: Uint8Array): RequestContextResult {
  const context = "RequestContextResult"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3], context)
  const result = oneofField(fields, [1, 2, 3], context)
  switch (result.field) {
    case 1: {
      const successContext = "RequestContextSuccess"
      const success = decodeFieldsStrict(result.bytes, { context: successContext })
      assertKnownFields(success, [1], successContext)
      const requestContext = oneofField(success, [1], successContext)
      return { kind: "success", requestContext: decodeRequestContext(requestContext.bytes) }
    }
    case 2:
      return { kind: "error", error: decodeSingleString(result.bytes, "RequestContextError") }
    case 3:
      return {
        kind: "rejected",
        reason: decodeSingleString(result.bytes, "RequestContextRejected"),
      }
    default:
      throw new CursorProtocolDriftError(context, result.field)
  }
}

export function encodeRequestContextResult(result: RequestContextResult): Uint8Array {
  switch (result.kind) {
    case "success":
      return encodeBytesField(1, encodeBytesField(1, encodeRequestContext(result.requestContext)))
    case "error":
      return encodeBytesField(2, encodeStringField(1, result.error))
    case "rejected":
      return encodeBytesField(3, encodeStringField(1, result.reason))
    default:
      return unreachableVariant(result, "RequestContextResult")
  }
}
