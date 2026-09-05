// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import { parseProviderId } from "../../core/ids.js"
import { generateFromCursorStream } from "./language-generate.js"
import { type CursorNdjsonStream, createCursorLegacyStream } from "./legacy-stream.js"
import { cursorPromptText } from "./prompt.js"
import { emptyCursorUsage } from "./usage.js"

export type CursorLanguageModelOptions = {
  readonly modelId: string
  readonly runPrompt: (prompt: string, signal: AbortSignal) => Promise<string | null>
  readonly directRuntime?: {
    readonly doStream: (
      call: LanguageModelV3CallOptions,
      modelId: string,
    ) => Promise<{ readonly stream: ReadableStream<LanguageModelV3StreamPart> }>
  }
  readonly streamNdjson?: CursorNdjsonStream
}

export function createCursorLanguageModel(options: CursorLanguageModelOptions): LanguageModelV3 {
  const provider = parseProviderId("cursor")
  const model: LanguageModelV3 = {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async (call: LanguageModelV3CallOptions) => {
      if (options.directRuntime !== undefined) {
        return generateFromCursorStream(
          (await options.directRuntime.doStream(call, options.modelId)).stream,
        )
      }
      if (options.streamNdjson !== undefined) {
        return generateFromCursorStream((await model.doStream(call)).stream)
      }
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("cursor-generate")
      }
      const text = await options.runPrompt(cursorPromptText(call), signal)
      if (text === null) {
        throw new AdapterError({
          operation: "cursor-agent-unavailable",
          retryable: false,
          cause: null,
          providerId: provider,
        })
      }
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: emptyCursorUsage(),
        warnings: [],
      }
    },
    doStream: async (call: LanguageModelV3CallOptions) => {
      if (options.directRuntime !== undefined) {
        return options.directRuntime.doStream(call, options.modelId)
      }
      const signal = call.abortSignal ?? new AbortController().signal
      if (signal.aborted) {
        throw new OperationCancelledError("cursor-stream")
      }
      const streamNdjson = options.streamNdjson
      if (streamNdjson !== undefined) {
        return { stream: createCursorLegacyStream({ call, signal, streamNdjson }) }
      }

      // Fallback to runPrompt (non-streaming)
      const generated = await createCursorLanguageModel(options).doGenerate(call)
      const textPart = generated.content.at(0)
      const text = textPart !== undefined && textPart.type === "text" ? textPart.text : ""
      const stream = new ReadableStream({
        start(controller): void {
          controller.enqueue({ type: "stream-start", warnings: [] })
          controller.enqueue({ type: "text-start", id: "text-1" })
          controller.enqueue({ type: "text-delta", id: "text-1", delta: text })
          controller.enqueue({ type: "text-end", id: "text-1" })
          controller.enqueue({
            type: "finish",
            finishReason: generated.finishReason,
            usage: generated.usage,
          })
          controller.close()
        },
      })
      return { stream }
    },
  }
  return model
}
