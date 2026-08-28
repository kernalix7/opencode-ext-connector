// Derived from Rahularya01/pi-cursor proto/agent.proto exec/request-context fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBoolField,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
} from "../proto-wire"
import { CursorProtocolDriftError, unreachableVariant } from "./errors"
import {
  assertKnownFields,
  oneofField,
  optionalBool,
  optionalField,
  optionalString,
  optionalUint32,
} from "./fields"
import {
  decodeMcpArgs,
  decodeMcpResult,
  encodeMcpArgs,
  encodeMcpResult,
  type McpArgs,
  type McpResult,
} from "./mcp"
import {
  decodeRequestContextResult,
  encodeRequestContextResult,
  type RequestContextResult,
} from "./request-context"

export type { RequestContext, RequestContextResult } from "./request-context"

type ExecIdentity = { readonly id: number; readonly execId: string }

export type ExecServerMessage = ExecIdentity &
  (
    | { readonly kind: "metadata"; readonly acceptHookAdditionalContexts: boolean }
    | {
        readonly kind: "request-context-args"
        readonly notesSessionId?: string
        readonly workspaceId?: string
      }
    | {
        readonly kind: "mcp-args"
        readonly args: McpArgs
      }
    | {
        readonly kind: "native"
        readonly operation: ExecNativeOperation
        readonly field: number
        readonly payload: Uint8Array
        readonly spanContext?: Uint8Array
      }
  )

export type ExecClientMessage =
  | {
      readonly kind: "request-context-result"
      readonly id: number
      readonly execId: string
      readonly result: RequestContextResult
    }
  | {
      readonly kind: "mcp-result"
      readonly id: number
      readonly execId: string
      readonly result: McpResult
    }
  | {
      readonly kind: "native"
      readonly operation: ExecNativeOperation
      readonly field: number
      readonly id: number
      readonly execId: string
      readonly payload: Uint8Array
    }

export type ExecNativeOperation =
  | "shell"
  | "write"
  | "delete"
  | "grep"
  | "read"
  | "ls"
  | "diagnostics"
  | "shell-stream"
  | "background-shell-spawn"
  | "list-mcp-resources"
  | "read-mcp-resource"
  | "fetch"
  | "record-screen"
  | "computer-use"
  | "write-shell-stdin"

const NATIVE_EXEC_FIELDS: Readonly<Record<number, ExecNativeOperation>> = {
  2: "shell",
  3: "write",
  4: "delete",
  5: "grep",
  7: "read",
  8: "ls",
  9: "diagnostics",
  14: "shell-stream",
  16: "background-shell-spawn",
  17: "list-mcp-resources",
  18: "read-mcp-resource",
  20: "fetch",
  21: "record-screen",
  22: "computer-use",
  23: "write-shell-stdin",
}

const EXEC_MESSAGE_FIELDS = [2, 3, 4, 5, 7, 8, 9, 10, 11, 14, 16, 17, 18, 20, 21, 22, 23]

function execIdentity(
  fields: ReturnType<typeof decodeFieldsStrict>,
  context: string,
): ExecIdentity {
  const id = optionalUint32(fields, { context, field: 1, wire: 0 }) ?? 0
  const execId = optionalString(fields, { context, field: 15, wire: 2 }) ?? ""
  return { id, execId }
}

export function decodeExecServerMessage(bytes: Uint8Array): ExecServerMessage {
  const context = "ExecServerMessage"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, ...EXEC_MESSAGE_FIELDS, 15, 19, 55], context)
  const identity = execIdentity(fields, context)
  const acceptHookAdditionalContexts = optionalBool(fields, { context, field: 55, wire: 0 })
  const span = optionalField(fields, { context, field: 19, wire: 2 })
  const variantCount = fields.filter((field) => EXEC_MESSAGE_FIELDS.includes(field.field)).length
  if (variantCount === 0 && acceptHookAdditionalContexts !== undefined) {
    return { kind: "metadata", ...identity, acceptHookAdditionalContexts }
  }
  const message = oneofField(fields, EXEC_MESSAGE_FIELDS, context)
  switch (message.field) {
    case 10: {
      const argsContext = "RequestContextArgs"
      const args = decodeFieldsStrict(message.bytes, { context: argsContext })
      assertKnownFields(args, [2, 3], argsContext)
      const notesSessionId = optionalString(args, { context: argsContext, field: 2, wire: 2 })
      const workspaceId = optionalString(args, { context: argsContext, field: 3, wire: 2 })
      return {
        kind: "request-context-args",
        ...identity,
        ...(notesSessionId === undefined ? {} : { notesSessionId }),
        ...(workspaceId === undefined ? {} : { workspaceId }),
      }
    }
    case 11:
      return { kind: "mcp-args", ...identity, args: decodeMcpArgs(message.bytes) }
    default: {
      const operation = NATIVE_EXEC_FIELDS[message.field]
      if (operation === undefined) throw new CursorProtocolDriftError(context, message.field)
      return {
        kind: "native",
        operation,
        field: message.field,
        ...identity,
        payload: message.bytes,
        ...(span === undefined ? {} : { spanContext: span.bytes }),
      }
    }
  }
}

export function encodeExecServerMessage(message: ExecServerMessage): Uint8Array {
  const id = encodeInt32Field(1, message.id)
  const execId = encodeStringField(15, message.execId)
  switch (message.kind) {
    case "metadata":
      return concatBytes([id, execId, encodeBoolField(55, message.acceptHookAdditionalContexts)])
    case "request-context-args":
      return concatBytes([
        id,
        encodeBytesField(
          10,
          concatBytes([
            ...(message.notesSessionId === undefined
              ? []
              : [encodeStringField(2, message.notesSessionId)]),
            ...(message.workspaceId === undefined
              ? []
              : [encodeStringField(3, message.workspaceId)]),
          ]),
        ),
        execId,
      ])
    case "mcp-args": {
      const payload = encodeBytesField(11, encodeMcpArgs(message.args))
      return concatBytes([id, payload, execId])
    }
    case "native":
      return concatBytes([
        id,
        encodeBytesField(message.field, message.payload),
        execId,
        ...(message.spanContext === undefined ? [] : [encodeBytesField(19, message.spanContext)]),
      ])
    default:
      return unreachableVariant(message, "ExecServerMessage")
  }
}

export function decodeExecClientMessage(bytes: Uint8Array): ExecClientMessage {
  const context = "ExecClientMessage"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, ...EXEC_MESSAGE_FIELDS, 15], context)
  const identity = execIdentity(fields, context)
  const message = oneofField(fields, EXEC_MESSAGE_FIELDS, context)
  switch (message.field) {
    case 10:
      return {
        kind: "request-context-result",
        ...identity,
        result: decodeRequestContextResult(message.bytes),
      }
    case 11:
      return { kind: "mcp-result", ...identity, result: decodeMcpResult(message.bytes) }
    default: {
      const operation = NATIVE_EXEC_FIELDS[message.field]
      if (operation === undefined) throw new CursorProtocolDriftError(context, message.field)
      return {
        kind: "native",
        operation,
        field: message.field,
        ...identity,
        payload: message.bytes,
      }
    }
  }
}

export function encodeExecClientMessage(message: ExecClientMessage): Uint8Array {
  const id = encodeInt32Field(1, message.id)
  const execId = encodeStringField(15, message.execId)
  switch (message.kind) {
    case "request-context-result":
      return concatBytes([
        id,
        encodeBytesField(10, encodeRequestContextResult(message.result)),
        execId,
      ])
    case "mcp-result":
      return concatBytes([id, encodeBytesField(11, encodeMcpResult(message.result)), execId])
    case "native":
      return concatBytes([id, encodeBytesField(message.field, message.payload), execId])
    default:
      return unreachableVariant(message, "ExecClientMessage")
  }
}
