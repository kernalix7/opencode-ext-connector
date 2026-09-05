// Derived from Rahularya01/pi-cursor proto/agent.proto MCP fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { decodeProtobufValueStrict, encodeProtobufValue } from "../proto-value.js"
import {
  concatBytes,
  decodeFieldsStrict,
  decodeUtf8Strict,
  encodeBytesField,
  encodeStringField,
} from "../proto-wire.js"
import { CursorProtocolError } from "./errors.js"
import {
  assertKnownFields,
  optionalField,
  optionalString,
  repeatedFields,
  requiredField,
  requiredString,
} from "./fields.js"

export {
  decodeMcpResult,
  decodeMcpToolResult,
  encodeMcpResult,
  encodeMcpToolResult,
  type McpResult,
  type McpResultContent,
  type McpToolResult,
  type OutputLocation,
} from "./mcp-result.js"

export type McpToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
  readonly providerIdentifier: string
  readonly toolName: string
}

export type McpArgs = {
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
  readonly toolCallId: string
  readonly providerIdentifier: string
  readonly toolName: string
}

export function decodeMcpToolDefinition(bytes: Uint8Array): McpToolDefinition {
  const context = "McpToolDefinition"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5], context)
  return {
    name: requiredString(fields, { context, field: 1, wire: 2 }),
    description: requiredString(fields, { context, field: 2, wire: 2 }),
    inputSchema: decodeProtobufValueStrict(
      requiredField(fields, { context, field: 3, wire: 2 }).bytes,
    ),
    providerIdentifier: requiredString(fields, { context, field: 4, wire: 2 }),
    toolName: requiredString(fields, { context, field: 5, wire: 2 }),
  }
}

export function encodeMcpToolDefinition(definition: McpToolDefinition): Uint8Array {
  return concatBytes([
    encodeStringField(1, definition.name),
    encodeStringField(2, definition.description),
    encodeBytesField(3, encodeProtobufValue(definition.inputSchema)),
    encodeStringField(4, definition.providerIdentifier),
    encodeStringField(5, definition.toolName),
  ])
}

function decodeArgEntry(bytes: Uint8Array): { readonly key: string; readonly value: unknown } {
  const context = "McpArgs.ArgsEntry"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2], context)
  const value = optionalField(fields, { context, field: 2, wire: 2 })
  return {
    key: optionalString(fields, { context, field: 1, wire: 2 }) ?? "",
    value: decodeArgValue(value?.bytes ?? new Uint8Array()),
  }
}

function decodeArgValue(bytes: Uint8Array): unknown {
  const first = bytes.at(0)
  const valueTags = [0x08, 0x11, 0x1a, 0x20, 0x2a, 0x32]
  return first !== undefined && valueTags.includes(first)
    ? decodeProtobufValueStrict(bytes)
    : decodeUtf8Strict(bytes, "McpArgs.ArgsEntry value")
}

export function decodeMcpArgs(bytes: Uint8Array): McpArgs {
  const context = "McpArgs"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5], context)
  const args: Record<string, unknown> = {}
  for (const field of repeatedFields(fields, { context, field: 2, wire: 2 })) {
    const entry = decodeArgEntry(field.bytes)
    if (Object.hasOwn(args, entry.key)) {
      throw new CursorProtocolError("malformed", context, `duplicate argument ${entry.key}`)
    }
    args[entry.key] = entry.value
  }
  return {
    name: optionalString(fields, { context, field: 1, wire: 2 }) ?? "",
    args,
    toolCallId: optionalString(fields, { context, field: 3, wire: 2 }) ?? "",
    providerIdentifier: optionalString(fields, { context, field: 4, wire: 2 }) ?? "",
    toolName: optionalString(fields, { context, field: 5, wire: 2 }) ?? "",
  }
}

export function encodeMcpArgs(args: McpArgs): Uint8Array {
  const entries = Object.keys(args.args).map((key) =>
    encodeBytesField(
      2,
      concatBytes([
        ...(key === "" ? [] : [encodeStringField(1, key)]),
        encodeBytesField(2, encodeProtobufValue(args.args[key])),
      ]),
    ),
  )
  return concatBytes([
    ...(args.name === "" ? [] : [encodeStringField(1, args.name)]),
    ...entries,
    ...(args.toolCallId === "" ? [] : [encodeStringField(3, args.toolCallId)]),
    ...(args.providerIdentifier === "" ? [] : [encodeStringField(4, args.providerIdentifier)]),
    ...(args.toolName === "" ? [] : [encodeStringField(5, args.toolName)]),
  ])
}
