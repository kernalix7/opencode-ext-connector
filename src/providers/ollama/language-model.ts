import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"

import { OperationCancelledError } from "../../core/errors"
import type { OllamaCatalogState } from "./catalog-state"
import { generateFromOllamaStream } from "./generate"
import type { OllamaFetch } from "./http"
import { buildOllamaCall } from "./prompt"
import { createOllamaRuntime, type OllamaRuntime } from "./runtime"
import { createOllamaChatStream } from "./stream"

export type OllamaLanguageModelOptions = {
  readonly modelId: string
  readonly runtime?: OllamaRuntime
  readonly catalog?: OllamaCatalogState
  readonly fetch?: OllamaFetch
}

function runtimeFromOptions(options: OllamaLanguageModelOptions): OllamaRuntime {
  if (options.runtime !== undefined) return options.runtime
  if (options.catalog === undefined) throw new TypeError("Ollama catalog state is required")
  return createOllamaRuntime({
    catalog: options.catalog,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
}

export function createOllamaLanguageModel(options: OllamaLanguageModelOptions): LanguageModelV3 {
  const runtime = runtimeFromOptions(options)
  const doStream = async (
    call: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> => {
    const built = buildOllamaCall(options.modelId, call)
    if (call.abortSignal?.aborted === true) throw new OperationCancelledError("ollama-chat")
    const lifecycle = new AbortController()
    let finalized = false
    const finalize = (): void => {
      if (finalized) return
      finalized = true
      call.abortSignal?.removeEventListener("abort", cancel)
    }
    const cancel = (): void => {
      if (!lifecycle.signal.aborted) {
        lifecycle.abort(new OperationCancelledError("ollama-chat"))
      }
    }
    call.abortSignal?.addEventListener("abort", cancel, { once: true })
    try {
      const response = await runtime.openChat(built.request, lifecycle.signal)
      return {
        stream: createOllamaChatStream({
          response,
          warnings: built.warnings,
          includeRawChunks: call.includeRawChunks === true,
          cancel,
          finalize,
        }),
        request: { body: built.request },
      }
    } catch (error) {
      finalize()
      throw error
    }
  }
  return {
    specificationVersion: "v3",
    provider: "ollama",
    modelId: options.modelId,
    supportedUrls: {},
    doStream,
    doGenerate: async (call) => generateFromOllamaStream((await doStream(call)).stream),
  }
}
