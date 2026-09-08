// Derived from brent-weatherall/opencode-commandcode-provider src/model.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"

import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import { parseProviderId } from "../../core/ids.js"
import { type CommandCodeVersionResolver, createCommandCodeVersionResolver } from "./cli-version.js"
import { emitCommandCodeChunks } from "./emit-stream.js"
import { commandCodeMissingBodyError } from "./errors.js"
import { openCommandCodeGeneration } from "./open-generation.js"
import {
  type BuildBodyOptions,
  type BuildHeadersOptions,
  buildBody,
  buildHeaders,
} from "./request.js"
import { createCommandCodeRequestLifecycle } from "./request-lifecycle.js"
import { type CommandCodeSessionId, createCommandCodeSessionId } from "./session.js"

export type CommandCodeLanguageModelOptions = {
  readonly modelId: string
  readonly transport: HttpTransport
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly readCliVersion?: CommandCodeVersionResolver
  readonly baseURL?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly generateSessionId?: () => string
}

type CommandCodeModelRuntime = CommandCodeLanguageModelOptions & {
  readonly sessionId: CommandCodeSessionId
  readonly readCliVersion: CommandCodeVersionResolver
}

type BuildRequestOptions = {
  readonly runtime: CommandCodeModelRuntime
  readonly call: LanguageModelV3CallOptions
  readonly token: string
  readonly cliVersion: string
  readonly bodySnapshot: Uint8Array
}

function buildRequestOptions(options: BuildRequestOptions) {
  const { runtime, call, token, cliVersion, bodySnapshot } = options
  const headerOptions: BuildHeadersOptions = {
    token,
    cliVersion,
    sessionId: runtime.sessionId,
  }
  const headers: Record<string, string> = {}
  for (const source of [buildHeaders(headerOptions), runtime.headers ?? {}, call.headers ?? {}]) {
    for (const [name, value] of Object.entries(source)) {
      if (value !== undefined) {
        headers[name.toLowerCase()] = value
      }
    }
  }
  return {
    url: `${(runtime.baseURL ?? "https://api.commandcode.ai").replace(/\/+$/, "")}/alpha/generate`,
    headers,
    body: new Uint8Array(bodySnapshot),
  }
}

function createUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  }
}

async function streamCommandCode(
  options: CommandCodeModelRuntime,
  call: LanguageModelV3CallOptions,
): Promise<LanguageModelV3StreamResult> {
  if (call.abortSignal?.aborted === true) {
    throw new OperationCancelledError("command-code-stream")
  }
  const lifecycle = createCommandCodeRequestLifecycle(
    call.abortSignal,
    options.timeoutMs ?? 5 * 60 * 1_000,
  )
  const token = await options.readAccessToken(lifecycle.signal)
  if (token === null) {
    lifecycle.dispose()
    throw new AdapterError({
      operation: "command-code-missing-credentials",
      retryable: false,
      cause: null,
      providerId: parseProviderId("command-code"),
    })
  }
  const cliVersion = await options.readCliVersion(lifecycle.signal)
  if (cliVersion === null) {
    lifecycle.dispose()
    throw new AdapterError({
      operation: "command-code-cli-version",
      retryable: false,
      cause: null,
      providerId: parseProviderId("command-code"),
    })
  }
  const bodyOptions: BuildBodyOptions = {
    modelId: options.modelId,
    call,
    sessionId: options.sessionId,
  }
  const bodySnapshot = new TextEncoder().encode(JSON.stringify(buildBody(bodyOptions)))
  let generation: Awaited<ReturnType<typeof openCommandCodeGeneration>>
  try {
    generation = await openCommandCodeGeneration({
      transport: options.transport,
      lifecycle,
      initialToken: token,
      readAccessToken: options.readAccessToken,
      createRequest: (accessToken) => {
        const request = buildRequestOptions({
          runtime: options,
          call,
          token: accessToken,
          cliVersion,
          bodySnapshot,
        })
        return {
          method: "POST",
          url: request.url,
          headers: request.headers,
          body: request.body,
        }
      },
    })
  } catch (error) {
    lifecycle.dispose()
    throw error
  }
  const { opened, request } = generation
  if (!opened.bodyPresent) {
    lifecycle.dispose()
    throw commandCodeMissingBodyError(opened.status)
  }
  let cancelled = false
  const stream = new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller): Promise<void> {
      try {
        await emitCommandCodeChunks(opened.chunks, controller)
      } catch (error) {
        if (!cancelled) {
          controller.enqueue({ type: "error", error })
        }
      } finally {
        lifecycle.dispose()
        if (!cancelled) {
          controller.close()
        }
      }
    },
    cancel(): void {
      cancelled = true
      lifecycle.abort()
      lifecycle.dispose()
    },
  })
  return {
    stream,
    request: { body: request.body === null ? undefined : new TextDecoder().decode(request.body) },
    response: { headers: opened.headers },
  }
}

export function createCommandCodeLanguageModel(
  options: CommandCodeLanguageModelOptions,
): LanguageModelV3 {
  const provider = parseProviderId("command-code")
  const sessionId = createCommandCodeSessionId(options.generateSessionId)
  const readCliVersion =
    options.readCliVersion ??
    createCommandCodeVersionResolver({
      env: options.env ?? process.env,
      transport: options.transport,
    })
  const runtime: CommandCodeModelRuntime = { ...options, sessionId, readCliVersion }
  return {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async (call: LanguageModelV3CallOptions) => {
      const { stream } = await streamCommandCode(runtime, call)
      const content: LanguageModelV3Content[] = []
      const text: string[] = []
      const reasoning: string[] = []
      let finish: LanguageModelV3FinishReason = { unified: "stop", raw: "stop" }
      let usage = createUsage()
      const reader = stream.getReader()
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) {
            break
          }
          const part = next.value
          switch (part.type) {
            case "text-delta":
              text.push(part.delta)
              break
            case "reasoning-delta":
              reasoning.push(part.delta)
              break
            case "tool-call":
              content.push({
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              })
              break
            case "finish":
              finish = part.finishReason
              usage = part.usage
              break
            case "error":
              throw part.error
          }
        }
      } finally {
        reader.releaseLock()
        await stream.cancel()
      }
      const textValue = text.join("")
      if (textValue.length > 0) {
        content.unshift({ type: "text", text: textValue })
      }
      const reasoningValue = reasoning.join("")
      if (reasoningValue.length > 0) {
        content.unshift({ type: "reasoning", text: reasoningValue })
      }
      return { content, finishReason: finish, usage, warnings: [] }
    },
    doStream: (call: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> =>
      streamCommandCode(runtime, call),
  }
}
