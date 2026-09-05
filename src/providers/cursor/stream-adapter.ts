import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { CursorReplayState } from "./recovery.js"
import type { CursorDispatchOutcome } from "./server-dispatch.js"
import { emptyCursorUsage } from "./usage.js"

type EmittableOutcome = Extract<
  CursorDispatchOutcome,
  { readonly kind: "text" | "thinking" | "mcp-parked" }
>

export type CursorStreamAdapter = {
  readonly stream: ReadableStream<LanguageModelV3StreamPart>
  readonly emit: (outcome: EmittableOutcome) => void
  readonly noteCheckpoint: () => void
  readonly replayState: () => CursorReplayState
  readonly suspendForRetry: () => void
  readonly finish: (reason: "stop" | "tool-calls") => void
  readonly fail: (error: unknown) => void
}

export function createCursorStreamAdapter(): CursorStreamAdapter {
  let streamController: ReadableStreamDefaultController<LanguageModelV3StreamPart> | null = null
  let outputEpoch = 0
  let checkpointEpoch: number | null = null
  let toolBoundary = false
  let section = 1
  let textStarted = false
  let reasoningStarted = false
  let settled = false
  const stream = new ReadableStream<LanguageModelV3StreamPart>({
    start(controller): void {
      streamController = controller
      controller.enqueue({ type: "stream-start", warnings: [] })
    },
  })
  const controller = (): ReadableStreamDefaultController<LanguageModelV3StreamPart> => {
    if (streamController === null) throw new TypeError("Cursor stream adapter is not initialized")
    return streamController
  }
  const closeSections = (): void => {
    if (reasoningStarted) {
      controller().enqueue({ type: "reasoning-end", id: `reasoning-${section}` })
      reasoningStarted = false
    }
    if (textStarted) {
      controller().enqueue({ type: "text-end", id: `text-${section}` })
      textStarted = false
    }
  }
  const emit = (outcome: EmittableOutcome): void => {
    if (settled) return
    switch (outcome.kind) {
      case "text":
        if (!textStarted) controller().enqueue({ type: "text-start", id: `text-${section}` })
        textStarted = true
        outputEpoch += 1
        controller().enqueue({ type: "text-delta", id: `text-${section}`, delta: outcome.text })
        return
      case "thinking":
        if (!reasoningStarted) {
          controller().enqueue({ type: "reasoning-start", id: `reasoning-${section}` })
        }
        reasoningStarted = true
        outputEpoch += 1
        controller().enqueue({
          type: "reasoning-delta",
          id: `reasoning-${section}`,
          delta: outcome.text,
        })
        return
      case "mcp-parked":
        toolBoundary = true
        controller().enqueue({
          type: "tool-call",
          toolCallId: outcome.parked.args.toolCallId,
          toolName: outcome.parked.args.toolName || outcome.parked.args.name,
          input: JSON.stringify(outcome.parked.args.args),
        })
        return
    }
  }
  const finish = (reason: "stop" | "tool-calls"): void => {
    if (settled) return
    settled = true
    closeSections()
    controller().enqueue({
      type: "finish",
      finishReason:
        reason === "tool-calls"
          ? { unified: "tool-calls", raw: "tool_calls" }
          : { unified: "stop", raw: "stop" },
      usage: emptyCursorUsage(),
    })
    controller().close()
  }
  return {
    stream,
    emit,
    noteCheckpoint: () => {
      checkpointEpoch = outputEpoch
    },
    replayState: (): CursorReplayState => ({ outputEpoch, checkpointEpoch, toolBoundary }),
    suspendForRetry: () => {
      closeSections()
      section += 1
    },
    finish,
    fail: (error) => {
      if (settled) return
      settled = true
      controller().error(error)
    },
  }
}
