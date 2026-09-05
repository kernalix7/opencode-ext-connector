import { encodeProtobufValue } from "./proto-value.js"
import { concatBytes, encodeBytesField, encodeStringField } from "./proto-wire.js"

export type CursorMcpTool = {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}

export function encodeMcpToolDefinition(tool: CursorMcpTool): Uint8Array {
  const schema = encodeProtobufValue(tool.inputSchema ?? { type: "object" })
  return concatBytes([
    encodeStringField(1, tool.name),
    encodeStringField(2, tool.description),
    encodeBytesField(3, schema),
    encodeStringField(4, "opencode"),
    encodeStringField(5, tool.name),
  ])
}

export function encodeCursorMcpTools(tools: readonly CursorMcpTool[]): Uint8Array {
  return concatBytes(tools.map((tool) => encodeBytesField(1, encodeMcpToolDefinition(tool))))
}
