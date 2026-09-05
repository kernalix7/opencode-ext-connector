import type {
  LanguageModelV3Prompt,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
} from "@ai-sdk/provider"

import { encodeCursorClientFrame } from "./exec-reply.js"
import type { McpResult, McpResultContent } from "./proto/mcp.js"
import type { ParkedMcpCall } from "./server-dispatch.js"

export type CursorToolContinuation = {
  readonly callId: string
  readonly frame: Uint8Array
}

export type CursorToolContinuationErrorReason =
  | "duplicate-result"
  | "malformed-result"
  | "mismatched-result"
  | "missing-result"

export class CursorToolContinuationError extends Error {
  public override readonly name = "CursorToolContinuationError"
  public readonly code = "CURSOR_TOOL_CONTINUATION_ERROR"
  public constructor(public readonly reason: CursorToolContinuationErrorReason) {
    super("Cursor tool continuation is invalid")
  }
}

type ValidatedCursorToolResult = {
  readonly callId: string
  readonly parked: ParkedMcpCall
  readonly result: McpResult
}

function jsonText(value: unknown): string {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new CursorToolContinuationError("malformed-result")
  }
  if (encoded === undefined) throw new CursorToolContinuationError("malformed-result")
  return encoded
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CursorToolContinuationError("malformed-result")
  }
  return new Uint8Array(Buffer.from(value, "base64"))
}

function successResult(content: readonly McpResultContent[], isError: boolean): McpResult {
  return {
    kind: "success",
    content: content.length === 0 ? [{ kind: "text", text: "" }] : content,
    isError,
  }
}

function contentResult(
  output: Extract<LanguageModelV3ToolResultOutput, { readonly type: "content" }>,
): McpResult {
  const content: McpResultContent[] = []
  for (const part of output.value) {
    switch (part.type) {
      case "text":
        content.push({ kind: "text", text: part.text })
        break
      case "image-data":
        content.push({ kind: "image", data: decodeBase64(part.data), mimeType: part.mediaType })
        break
      case "file-data":
        if (!part.mediaType.startsWith("image/")) {
          throw new CursorToolContinuationError("malformed-result")
        }
        content.push({ kind: "image", data: decodeBase64(part.data), mimeType: part.mediaType })
        break
      case "file-url":
      case "file-id":
      case "image-url":
      case "image-file-id":
      case "custom":
        throw new CursorToolContinuationError("malformed-result")
      default:
        return part satisfies never
    }
  }
  return successResult(content, false)
}

function mcpResult(output: LanguageModelV3ToolResultOutput): McpResult {
  switch (output.type) {
    case "text":
      return successResult([{ kind: "text", text: output.value }], false)
    case "json":
      return successResult([{ kind: "text", text: jsonText(output.value) }], false)
    case "content":
      return contentResult(output)
    case "error-text":
      return successResult([{ kind: "text", text: output.value }], true)
    case "error-json":
      return successResult([{ kind: "text", text: jsonText(output.value) }], true)
    case "execution-denied":
      return { kind: "rejected", reason: output.reason ?? "Execution denied", isReadonly: false }
    default:
      return output satisfies never
  }
}

function trailingResults(prompt: LanguageModelV3Prompt): readonly LanguageModelV3ToolResultPart[] {
  const results: LanguageModelV3ToolResultPart[] = []
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index]
    if (message?.role !== "tool") break
    results.unshift(...message.content.filter((part) => part.type === "tool-result"))
  }
  return results
}

function validateResults(
  results: readonly LanguageModelV3ToolResultPart[],
  parkedCalls: ReadonlyMap<string, ParkedMcpCall>,
): readonly ValidatedCursorToolResult[] {
  if (results.length === 0) throw new CursorToolContinuationError("missing-result")
  const resultsByCallId = new Map<string, LanguageModelV3ToolResultPart>()
  for (const result of results) {
    if (resultsByCallId.has(result.toolCallId)) {
      throw new CursorToolContinuationError("duplicate-result")
    }
    const parked = parkedCalls.get(result.toolCallId)
    if (
      parked === undefined ||
      (result.toolName !== parked.args.toolName && result.toolName !== parked.args.name)
    ) {
      throw new CursorToolContinuationError("mismatched-result")
    }
    resultsByCallId.set(result.toolCallId, result)
  }
  if (resultsByCallId.size !== parkedCalls.size) {
    throw new CursorToolContinuationError("missing-result")
  }
  const validated: ValidatedCursorToolResult[] = []
  for (const [callId, parked] of parkedCalls) {
    const result = resultsByCallId.get(callId)
    if (result === undefined) throw new CursorToolContinuationError("missing-result")
    validated.push({ callId, parked, result: mcpResult(result.output) })
  }
  return validated
}

export function buildCursorToolContinuations(
  prompt: LanguageModelV3Prompt,
  parkedCalls: ReadonlyMap<string, ParkedMcpCall>,
): readonly CursorToolContinuation[] {
  return validateResults(trailingResults(prompt), parkedCalls).map(({ callId, parked, result }) => {
    return {
      callId,
      frame: encodeCursorClientFrame({
        kind: "exec-client-message",
        message: {
          kind: "mcp-result",
          id: parked.execMessageId,
          execId: parked.execId,
          result,
        },
      }),
    }
  })
}
