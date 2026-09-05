// Derived from Rahularya01/pi-cursor AgentService/Run Connect framing.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { randomUUID } from "node:crypto"

import { AdapterError } from "../../core/errors.js"
import { parseProviderId } from "../../core/ids.js"
import {
  decodeConnectFrames,
  decodeConnectFramesWithRest,
  encodeConnectFrame,
} from "./connect-frame.js"
import { cursorServerReplies } from "./exec-reply.js"
import { type CursorHttp2Post, cursorHttp2Post, cursorHttp2Stream } from "./http2.js"
import { type CursorMcpTool, encodeCursorMcpTools } from "./mcp-tools.js"
import {
  concatBytes,
  decodeUtf8,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
} from "./proto-wire.js"
import { extractCursorRunEvents } from "./run-events.js"

export function buildCursorRunMessage(
  modelId: string,
  prompt: string,
  tools: readonly CursorMcpTool[] = [],
): Uint8Array {
  const messageId = randomUUID()
  const userMessage = concatBytes([
    encodeStringField(1, prompt),
    encodeStringField(2, messageId),
    encodeInt32Field(4, 1),
    encodeStringField(17, messageId),
  ])
  const action = encodeBytesField(1, encodeBytesField(1, userMessage))
  const conversationState = concatBytes([
    encodeInt32Field(10, 1),
    encodeStringField(22, "opencode"),
  ])
  const parts = [
    encodeBytesField(1, conversationState),
    encodeBytesField(2, action),
    encodeBytesField(3, encodeStringField(1, modelId)),
    encodeBytesField(4, encodeCursorMcpTools(tools)),
    encodeStringField(5, randomUUID()),
    encodeBytesField(9, encodeStringField(1, modelId)),
  ]
  return encodeBytesField(1, concatBytes(parts))
}

export function extractCursorTextDeltas(message: Uint8Array): readonly string[] {
  const deltas: string[] = []
  for (const event of extractCursorRunEvents(message)) {
    if (event.kind === "text") {
      deltas.push(event.text)
    }
  }
  return deltas
}

function connectErrorMessage(bytes: Uint8Array): string | null {
  const text = decodeUtf8(bytes).trim()
  if (!text.startsWith("{")) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) {
      return null
    }
    const error = Reflect.get(parsed, "error")
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = Reflect.get(error, "message")
      if (typeof message === "string" && message.length > 0) {
        return message
      }
    }
  } catch {
    return null
  }
  return text.includes('"error"') ? text : null
}

function* ndjsonFromFrames(
  frames: readonly { readonly bytes: Uint8Array }[],
): Generator<string, void> {
  for (const frame of frames) {
    const errorMessage = connectErrorMessage(frame.bytes)
    if (errorMessage !== null) {
      throw new Error(errorMessage)
    }
    for (const event of extractCursorRunEvents(frame.bytes)) {
      switch (event.kind) {
        case "text":
          yield JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: event.text }] },
          })
          break
        case "thinking":
          yield JSON.stringify({ type: "thinking", text: event.text })
          break
        case "tool":
          yield JSON.stringify({
            type: "tool_call",
            subtype: "started",
            call_id: event.callId,
            name: event.name,
            arguments: event.args,
          })
          break
        case "turn-ended":
          break
      }
    }
  }
}

export type CursorRunPost = (request: CursorHttp2Post) => Promise<{
  readonly status: number
  readonly body: Uint8Array
}>

export async function* streamCursorAssistantNdjson(
  modelId: string,
  prompt: string,
  token: string,
  signal: AbortSignal,
  post: CursorRunPost = cursorHttp2Post,
  tools: readonly CursorMcpTool[] = [],
): AsyncIterable<string> {
  let writeFrame: (frame: Uint8Array) => void = () => undefined
  const request = {
    path: "/agent.v1.AgentService/Run",
    token,
    body: encodeConnectFrame(buildCursorRunMessage(modelId, prompt, tools)),
    headers: {
      "content-type": "application/connect+proto",
      "connect-protocol-version": "1",
    },
    signal,
    keepOpen: true,
    heartbeat: encodeConnectFrame(encodeBytesField(7, new Uint8Array())),
    onWriter: (write: (frame: Uint8Array) => void) => {
      writeFrame = write
    },
  }
  if (post !== cursorHttp2Post) {
    const response = await post(request)
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError({
        operation: "cursor-run-http",
        retryable: response.status >= 500,
        cause: null,
        providerId: parseProviderId("cursor"),
      })
    }
    yield* ndjsonFromFrames(decodeConnectFrames(response.body))
    yield JSON.stringify({ type: "result", result: "" })
    return
  }
  let rest = new Uint8Array()
  stream: for await (const chunk of cursorHttp2Stream(request)) {
    const split = decodeConnectFramesWithRest(concatBytes([rest, chunk]))
    rest = new Uint8Array(split.rest)
    for (const frame of split.frames) {
      for (const reply of cursorServerReplies(frame.bytes, tools)) {
        writeFrame(reply)
      }
    }
    for (const line of ndjsonFromFrames(split.frames)) {
      yield line
    }
    for (const frame of split.frames) {
      for (const event of extractCursorRunEvents(frame.bytes)) {
        if (event.kind === "turn-ended") {
          break stream
        }
      }
    }
  }
  yield JSON.stringify({ type: "result", result: "" })
}
