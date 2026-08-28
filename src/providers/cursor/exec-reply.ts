// Derived from Rahularya01/pi-cursor src/stream/server-messages.ts exec replies.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { encodeConnectFrame } from "./connect-frame"
import type { CursorMcpTool } from "./mcp-tools"
import type { ExecNativeOperation, ExecServerMessage } from "./proto/exec"
import type { McpToolDefinition } from "./proto/mcp"
import { type AgentClientMessage, encodeAgentClientMessage } from "./proto/request"
import { decodeAgentServerMessage } from "./proto/server"
import {
  concatBytes,
  encodeBoolField,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
} from "./proto-wire"

const NATIVE_REJECT =
  "This native Cursor tool is not available. Use the MCP tools provided instead."

export function cursorMcpDefinitions(
  tools: readonly CursorMcpTool[],
): readonly McpToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    providerIdentifier: "opencode",
    toolName: tool.name,
  }))
}

export function encodeCursorClientFrame(message: AgentClientMessage): Uint8Array {
  return encodeConnectFrame(encodeAgentClientMessage(message))
}

export function encodeRequestContextFrame(
  message: Extract<ExecServerMessage, { readonly kind: "request-context-args" }>,
  tools: readonly CursorMcpTool[],
): Uint8Array {
  return encodeCursorClientFrame({
    kind: "exec-client-message",
    message: {
      kind: "request-context-result",
      id: message.id,
      execId: message.execId,
      result: { kind: "success", requestContext: { tools: cursorMcpDefinitions(tools) } },
    },
  })
}

function rejectedPath(): Uint8Array {
  return encodeBytesField(
    3,
    concatBytes([encodeStringField(1, ""), encodeStringField(2, NATIVE_REJECT)]),
  )
}

function rejectedError(): Uint8Array {
  return encodeBytesField(2, encodeStringField(1, NATIVE_REJECT))
}

function nativeRejectionPayload(operation: ExecNativeOperation): Uint8Array {
  switch (operation) {
    case "shell":
    case "shell-stream":
    case "background-shell-spawn":
      return encodeBytesField(
        operation === "background-shell-spawn" ? 3 : 4,
        concatBytes([
          encodeStringField(1, ""),
          encodeStringField(2, ""),
          encodeStringField(3, NATIVE_REJECT),
          encodeBoolField(4, false),
        ]),
      )
    case "write":
    case "delete":
    case "read":
    case "ls":
      return rejectedPath()
    case "grep":
    case "write-shell-stdin":
    case "list-mcp-resources":
    case "record-screen":
      return rejectedError()
    case "read-mcp-resource":
    case "fetch":
      return encodeBytesField(
        2,
        concatBytes([encodeStringField(1, ""), encodeStringField(2, NATIVE_REJECT)]),
      )
    case "computer-use":
      return encodeBytesField(
        2,
        concatBytes([
          encodeStringField(1, NATIVE_REJECT),
          encodeInt32Field(2, 0),
          encodeInt32Field(3, 0),
        ]),
      )
    case "diagnostics":
      return new Uint8Array()
    default:
      return operation satisfies never
  }
}

export function encodeNativeRejectFrame(
  message: Extract<ExecServerMessage, { readonly kind: "native" }>,
): Uint8Array {
  return encodeCursorClientFrame({
    kind: "exec-client-message",
    message: {
      kind: "native",
      operation: message.operation,
      field: message.field,
      id: message.id,
      execId: message.execId,
      payload: nativeRejectionPayload(message.operation),
    },
  })
}

export function cursorServerReplies(
  bytes: Uint8Array,
  tools: readonly CursorMcpTool[],
): readonly Uint8Array[] {
  const server = decodeAgentServerMessage(bytes)
  if (server.kind !== "exec-server-message") return []
  switch (server.message.kind) {
    case "request-context-args":
      return [encodeRequestContextFrame(server.message, tools)]
    case "native":
      return [encodeNativeRejectFrame(server.message)]
    case "metadata":
      return []
    case "mcp-args":
      return []
    default:
      return server.message satisfies never
  }
}
