// Derived from Rahularya01/pi-cursor proto/agent.proto McpResult fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  decodeUtf8Strict,
  encodeBoolField,
  encodeBytesField,
  encodeStringField,
} from "../proto-wire"
import { CursorProtocolDriftError, unreachableVariant } from "./errors"
import {
  assertKnownFields,
  oneofField,
  optionalBool,
  optionalField,
  repeatedFields,
  requiredField,
  requiredString,
} from "./fields"
import { decodeOutputLocation, encodeOutputLocation, type OutputLocation } from "./output-location"
import { encodeUnknownField } from "./unknown-field"

export type { OutputLocation } from "./output-location"

export type McpResultContent =
  | { readonly kind: "text"; readonly text: string; readonly outputLocation?: OutputLocation }
  | { readonly kind: "image"; readonly data: Uint8Array; readonly mimeType: string }

export type McpResult =
  | {
      readonly kind: "success"
      readonly content: readonly McpResultContent[]
      readonly isError: boolean
    }
  | { readonly kind: "error"; readonly error: string }
  | { readonly kind: "rejected"; readonly reason: string; readonly isReadonly: boolean }
  | { readonly kind: "permission-denied"; readonly error: string; readonly isReadonly: boolean }
  | {
      readonly kind: "tool-not-found"
      readonly name: string
      readonly availableTools: readonly string[]
    }

export type McpToolResult =
  | McpResult
  | { readonly kind: "unknown-oneof"; readonly field: number; readonly payload: Uint8Array }

function decodeContent(bytes: Uint8Array): McpResultContent {
  const context = "McpToolResultContentItem"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2], context)
  const content = oneofField(fields, [1, 2], context)
  switch (content.field) {
    case 1: {
      const textContext = "McpTextContent"
      const textFields = decodeFieldsStrict(content.bytes, { context: textContext })
      assertKnownFields(textFields, [1, 2], textContext)
      const outputLocation = optionalField(textFields, { context: textContext, field: 2, wire: 2 })
      return {
        kind: "text",
        text: requiredString(textFields, { context: textContext, field: 1, wire: 2 }),
        ...(outputLocation === undefined
          ? {}
          : { outputLocation: decodeOutputLocation(outputLocation.bytes) }),
      }
    }
    case 2: {
      const imageContext = "McpImageContent"
      const imageFields = decodeFieldsStrict(content.bytes, { context: imageContext })
      assertKnownFields(imageFields, [1, 2], imageContext)
      return {
        kind: "image",
        data: requiredField(imageFields, { context: imageContext, field: 1, wire: 2 }).bytes,
        mimeType: requiredString(imageFields, { context: imageContext, field: 2, wire: 2 }),
      }
    }
    default:
      throw new CursorProtocolDriftError(context, content.field)
  }
}

function encodeContent(content: McpResultContent): Uint8Array {
  switch (content.kind) {
    case "text":
      return encodeBytesField(
        1,
        concatBytes([
          encodeStringField(1, content.text),
          ...(content.outputLocation === undefined
            ? []
            : [encodeBytesField(2, encodeOutputLocation(content.outputLocation))]),
        ]),
      )
    case "image":
      return encodeBytesField(
        2,
        concatBytes([encodeBytesField(1, content.data), encodeStringField(2, content.mimeType)]),
      )
    default:
      return unreachableVariant(content, "McpToolResultContentItem")
  }
}

function decodeSuccess(bytes: Uint8Array): McpResult {
  const context = "McpSuccess"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2], context)
  return {
    kind: "success",
    content: repeatedFields(fields, { context, field: 1, wire: 2 }).map((entry) =>
      decodeContent(entry.bytes),
    ),
    isError: optionalBool(fields, { context, field: 2, wire: 0 }) ?? false,
  }
}

function decodeMessage(bytes: Uint8Array, context: string): string {
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1], context)
  return requiredString(fields, { context, field: 1, wire: 2 })
}

function decodeReadonlyMessage(
  bytes: Uint8Array,
  context: string,
): { readonly message: string; readonly isReadonly: boolean } {
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2], context)
  return {
    message: requiredString(fields, { context, field: 1, wire: 2 }),
    isReadonly: optionalBool(fields, { context, field: 2, wire: 0 }) ?? false,
  }
}

export function decodeMcpResult(bytes: Uint8Array): McpResult {
  const context = "McpResult"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5], context)
  const result = oneofField(fields, [1, 2, 3, 4, 5], context)
  switch (result.field) {
    case 1:
      return decodeSuccess(result.bytes)
    case 2:
      return { kind: "error", error: decodeMessage(result.bytes, "McpError") }
    case 3: {
      const rejected = decodeReadonlyMessage(result.bytes, "McpRejected")
      return { kind: "rejected", reason: rejected.message, isReadonly: rejected.isReadonly }
    }
    case 4: {
      const denied = decodeReadonlyMessage(result.bytes, "McpPermissionDenied")
      return { kind: "permission-denied", error: denied.message, isReadonly: denied.isReadonly }
    }
    case 5: {
      const itemContext = "McpToolNotFound"
      const itemFields = decodeFieldsStrict(result.bytes, { context: itemContext })
      assertKnownFields(itemFields, [1, 2], itemContext)
      return {
        kind: "tool-not-found",
        name: requiredString(itemFields, { context: itemContext, field: 1, wire: 2 }),
        availableTools: repeatedFields(itemFields, { context: itemContext, field: 2, wire: 2 }).map(
          (entry) => decodeUtf8Strict(entry.bytes, `${itemContext} field 2`),
        ),
      }
    }
    default:
      throw new CursorProtocolDriftError(context, result.field)
  }
}

export function encodeMcpResult(result: McpResult): Uint8Array {
  switch (result.kind) {
    case "success":
      return encodeBytesField(
        1,
        concatBytes([
          ...result.content.map((content) => encodeBytesField(1, encodeContent(content))),
          encodeBoolField(2, result.isError),
        ]),
      )
    case "error":
      return encodeBytesField(2, encodeStringField(1, result.error))
    case "rejected":
      return encodeBytesField(
        3,
        concatBytes([encodeStringField(1, result.reason), encodeBoolField(2, result.isReadonly)]),
      )
    case "permission-denied":
      return encodeBytesField(
        4,
        concatBytes([encodeStringField(1, result.error), encodeBoolField(2, result.isReadonly)]),
      )
    case "tool-not-found":
      return encodeBytesField(
        5,
        concatBytes([
          encodeStringField(1, result.name),
          ...result.availableTools.map((name) => encodeStringField(2, name)),
        ]),
      )
    default:
      return unreachableVariant(result, "McpResult")
  }
}

export function decodeMcpToolResult(bytes: Uint8Array): McpToolResult {
  const context = "McpToolResult"
  const fields = decodeFieldsStrict(bytes, { context })
  const result = oneofField(
    fields,
    fields.map((field) => field.field),
    context,
  )
  if (result.field > 4) {
    return { kind: "unknown-oneof", field: result.field, payload: result.bytes }
  }
  return decodeMcpResult(encodeUnknownField(result.field, 2, result.bytes))
}

export function encodeMcpToolResult(result: McpToolResult): Uint8Array {
  if (result.kind === "unknown-oneof") {
    return encodeBytesField(result.field, result.payload)
  }
  if (result.kind === "tool-not-found") {
    throw new CursorProtocolDriftError("McpToolResult", 5)
  }
  return encodeMcpResult(result)
}
