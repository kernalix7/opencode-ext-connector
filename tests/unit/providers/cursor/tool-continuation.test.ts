import { describe, expect, it } from "bun:test"

import type { LanguageModelV3ToolResultOutput } from "@ai-sdk/provider"

import { decodeConnectFramesStrict } from "../../../../src/providers/cursor/connect-frame"
import type { McpResult } from "../../../../src/providers/cursor/proto/mcp"
import { decodeAgentClientMessage } from "../../../../src/providers/cursor/proto/request"
import type { ParkedMcpCall } from "../../../../src/providers/cursor/server-dispatch"
import {
  buildCursorToolContinuations,
  CursorToolContinuationError,
} from "../../../../src/providers/cursor/tool-continuation"

type CyclicJson = { self?: CyclicJson }

function parked(callId: string): ParkedMcpCall {
  return {
    callId,
    execId: "exec-1",
    execMessageId: 19,
    args: {
      name: "read",
      args: {},
      toolCallId: callId,
      providerIdentifier: "opencode",
      toolName: "read",
    },
  }
}

function promptFor(output: LanguageModelV3ToolResultOutput, callId = "call-1", toolName = "read") {
  return [
    {
      role: "tool" as const,
      content: [{ type: "tool-result" as const, toolCallId: callId, toolName, output }],
    },
  ]
}

function decodedContinuation(frame: Uint8Array): ReturnType<typeof decodeAgentClientMessage> {
  const connectFrame = decodeConnectFramesStrict(frame).at(0)
  if (connectFrame === undefined) throw new Error("fixture expected a connect frame")
  return decodeAgentClientMessage(connectFrame.bytes)
}

function decodedResult(frame: Uint8Array): McpResult {
  const decoded = decodedContinuation(frame)
  if (decoded.kind !== "exec-client-message" || decoded.message.kind !== "mcp-result") {
    throw new Error("fixture expected an MCP result")
  }
  return decoded.message.result
}

function success(text: string, isError = false): McpResult {
  return { kind: "success", content: [{ kind: "text", text }], isError }
}

function resultFor(
  output: LanguageModelV3ToolResultOutput,
  calls = new Map([["call-1", parked("call-1")]]),
): McpResult {
  const continuation = buildCursorToolContinuations(promptFor(output), calls)[0]
  if (continuation === undefined) throw new Error("fixture expected a continuation")
  return decodedResult(continuation.frame)
}

describe("buildCursorToolContinuations", () => {
  it("encodes text and image content into the exact parked MCP result", () => {
    // Given
    const calls = new Map([["call-1", parked("call-1")]])
    const output = {
      type: "content",
      value: [
        { type: "text", text: "body" },
        { type: "image-data", data: "AQI=", mediaType: "image/png" },
      ],
    } satisfies LanguageModelV3ToolResultOutput
    const expected: McpResult = {
      kind: "success",
      content: [
        { kind: "text", text: "body" },
        { kind: "image", data: new Uint8Array([1, 2]), mimeType: "image/png" },
      ],
      isError: false,
    }

    // When
    const result = resultFor(output, calls)

    // Then
    expect(result).toEqual(expected)
  })

  it("rejects partial, extra, duplicate, and tool-name-mismatched result sets", () => {
    // Given
    const calls = new Map([
      ["call-a", parked("call-a")],
      ["call-b", parked("call-b")],
    ])
    const partial = promptFor({ type: "text", value: "A" }, "call-a")
    const extra = promptFor({ type: "text", value: "other" }, "other")
    const mismatched = promptFor({ type: "text", value: "A" }, "call-a", "write")
    const duplicate = [
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call-a",
            toolName: "read",
            output: { type: "text" as const, value: "first" },
          },
          {
            type: "tool-result" as const,
            toolCallId: "call-a",
            toolName: "read",
            output: { type: "text" as const, value: "second" },
          },
        ],
      },
    ]

    // When
    const builds = [
      (): readonly unknown[] => buildCursorToolContinuations(partial, calls),
      (): readonly unknown[] => buildCursorToolContinuations(extra, calls),
      (): readonly unknown[] => buildCursorToolContinuations(duplicate, calls),
      (): readonly unknown[] => buildCursorToolContinuations(mismatched, calls),
    ]

    // Then
    for (const build of builds) expect(build).toThrow(CursorToolContinuationError)
  })

  it("encodes each complete multi-call result once in parked-call order", () => {
    // Given
    const calls = new Map([
      ["call-a", { ...parked("call-a"), execId: "exec-a", execMessageId: 11 }],
      ["call-b", { ...parked("call-b"), execId: "exec-b", execMessageId: 22 }],
    ])
    const prompt = [
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call-b",
            toolName: "read",
            output: { type: "text" as const, value: "B" },
          },
          {
            type: "tool-result" as const,
            toolCallId: "call-a",
            toolName: "read",
            output: { type: "text" as const, value: "A" },
          },
        ],
      },
    ]

    // When
    const continuations = buildCursorToolContinuations(prompt, calls)
    const fields = continuations.map((continuation) => {
      const decoded = decodedContinuation(continuation.frame)
      if (decoded.kind !== "exec-client-message" || decoded.message.kind !== "mcp-result") {
        throw new Error("fixture expected an MCP result")
      }
      return decoded.message
    })

    // Then
    expect(continuations.map((continuation) => continuation.callId)).toEqual(["call-a", "call-b"])
    expect(fields).toEqual([
      { kind: "mcp-result", id: 11, execId: "exec-a", result: success("A") },
      { kind: "mcp-result", id: 22, execId: "exec-b", result: success("B") },
    ])
  })

  it("normalizes every V3 output class with pi-cursor executed-tool semantics", () => {
    // Given
    const cases = [
      { output: { type: "text", value: "text value" }, expected: success("text value") },
      { output: { type: "json", value: { value: 1 } }, expected: success('{"value":1}') },
      { output: { type: "content", value: [] }, expected: success("") },
      { output: { type: "error-text", value: "ENOENT" }, expected: success("ENOENT", true) },
      {
        output: { type: "error-json", value: { code: "ENOENT" } },
        expected: success('{"code":"ENOENT"}', true),
      },
      {
        output: { type: "execution-denied", reason: "User denied" },
        expected: { kind: "rejected", reason: "User denied", isReadonly: false },
      },
    ] satisfies readonly {
      readonly output: LanguageModelV3ToolResultOutput
      readonly expected: McpResult
    }[]

    // When
    const results = cases.map(({ output }) => resultFor(output))

    // Then
    expect(results).toEqual(cases.map(({ expected }) => expected))
  })

  it("rejects malformed base64 and JSON before encoding", () => {
    // Given
    const calls = new Map([["call-1", parked("call-1")]])
    const malformedJsonValue: CyclicJson = {}
    malformedJsonValue.self = malformedJsonValue
    const malformedBase64 = promptFor({
      type: "content",
      value: [{ type: "image-data", data: "not-base64", mediaType: "image/png" }],
    })
    const malformedJson = promptFor({ type: "json", value: malformedJsonValue })

    // When
    const builds = [
      (): readonly unknown[] => buildCursorToolContinuations(malformedBase64, calls),
      (): readonly unknown[] => buildCursorToolContinuations(malformedJson, calls),
    ]

    // Then
    for (const build of builds) expect(build).toThrow(CursorToolContinuationError)
  })
})
