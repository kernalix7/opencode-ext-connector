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

import { AdapterError, OperationCancelledError } from "../../core/errors"
import type { HttpTransport } from "../../core/http"
import { parseProviderId } from "../../core/ids"
import { type HttpBodyStream, openHttpBody } from "../../http/read-body"
import { type CommandCodeVersionResolver, createCommandCodeVersionResolver } from "./cli-version"
import { emitCommandCodeChunks } from "./emit-stream"
import { commandCodeMissingBodyError } from "./errors"
import { type BuildBodyOptions, type BuildHeadersOptions, buildBody, buildHeaders } from "./request"
import {
  commandCodeHttpError,
  createCommandCodeRequestLifecycle,
  readCommandCodeErrorBody,
} from "./request-lifecycle"
import { type CommandCodeSessionId, createCommandCodeSessionId } from "./session"

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

function buildRequestOptions(
  options: CommandCodeModelRuntime,
  call: LanguageModelV3CallOptions,
  token: string,
  cliVersion: string,
): { readonly url: string; readonly headers: Record<string, string>; readonly body: Uint8Array } {
  const bodyOptions: BuildBodyOptions = {
    modelId: options.modelId,
    call,
    sessionId: options.sessionId,
  }
  const headerOptions: BuildHeadersOptions = {
    token,
    cliVersion,
    sessionId: options.sessionId,
  }
  return {
    url: `${(options.baseURL ?? "https://api.commandcode.ai").replace(/\/+$/, "")}/alpha/generate`,
    headers: {
      ...buildHeaders(headerOptions),
      ...options.headers,
      ...Object.fromEntries(
        Object.entries(call.headers ?? {}).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    },
    body: new TextEncoder().encode(JSON.stringify(buildBody(bodyOptions))),
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

function createFinishReason(): LanguageModelV3FinishReason {
  return { unified: "stop", raw: "stop" }
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
  const requestOptions = buildRequestOptions(options, call, token, cliVersion)
  let opened: HttpBodyStream
  try {
    opened = await openHttpBody(
      options.transport,
      {
        method: "POST",
        url: requestOptions.url,
        headers: requestOptions.headers,
        body: requestOptions.body,
      },
      lifecycle.signal,
    )
  } catch (error) {
    lifecycle.dispose()
    throw error
  }
  if (opened.status < 200 || opened.status >= 300) {
    let errorBody: string
    try {
      errorBody = await readCommandCodeErrorBody(opened.chunks)
    } catch (error) {
      lifecycle.abort()
      throw error
    } finally {
      lifecycle.dispose()
    }
    throw commandCodeHttpError(opened.status, errorBody)
  }
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
    request: { body: new TextDecoder().decode(requestOptions.body) },
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
      let finish = createFinishReason()
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
