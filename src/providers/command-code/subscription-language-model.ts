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
import { buildBody, buildHeaders } from "./request.js"
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
type Runtime = CommandCodeLanguageModelOptions & {
  readonly sessionId: CommandCodeSessionId
  readonly readCliVersion: CommandCodeVersionResolver
}
const reservedAuthenticationHeaders = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
])

function missing(operation: string): AdapterError {
  return new AdapterError({
    operation,
    retryable: false,
    cause: null,
    providerId: parseProviderId("command-code"),
  })
}

function requestHeaders(
  runtime: Runtime,
  call: LanguageModelV3CallOptions,
  token: string,
  version: string,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const layer of [
    buildHeaders({ token, cliVersion: version, sessionId: runtime.sessionId }),
    runtime.headers ?? {},
    call.headers ?? {},
  ]) {
    for (const [name, value] of Object.entries(layer)) {
      if (value !== undefined && !reservedAuthenticationHeaders.has(name.toLowerCase()))
        headers[name.toLowerCase()] = value
    }
  }
  headers["authorization"] = `Bearer ${token}`
  return headers
}

async function streamCommandCode(
  runtime: Runtime,
  call: LanguageModelV3CallOptions,
): Promise<LanguageModelV3StreamResult> {
  if (call.abortSignal?.aborted) throw new OperationCancelledError("command-code-stream")
  const lifecycle = createCommandCodeRequestLifecycle(
    call.abortSignal,
    runtime.timeoutMs ?? 5 * 60 * 1_000,
  )
  try {
    const token = await runtime.readAccessToken(lifecycle.signal)
    if (lifecycle.signal.aborted) throw new OperationCancelledError("command-code-stream")
    if (token === null) throw missing("command-code-missing-credentials")
    const version = await runtime.readCliVersion(lifecycle.signal)
    if (lifecycle.signal.aborted) throw new OperationCancelledError("command-code-stream")
    if (version === null) throw missing("command-code-cli-version")
    const body = new TextEncoder().encode(
      JSON.stringify(buildBody({ modelId: runtime.modelId, call, sessionId: runtime.sessionId })),
    )
    const { opened, request } = await openCommandCodeGeneration({
      transport: runtime.transport,
      lifecycle,
      initialToken: token,
      readAccessToken: runtime.readAccessToken,
      createRequest: (accessToken) => ({
        method: "POST",
        url: `${(runtime.baseURL ?? "https://api.commandcode.ai").replace(/\/+$/, "")}/alpha/generate`,
        headers: requestHeaders(runtime, call, accessToken, version),
        body: new Uint8Array(body),
      }),
    })
    if (!opened.bodyPresent) {
      const iterator = opened.chunks[Symbol.asyncIterator]()
      await iterator.return?.()
      throw commandCodeMissingBodyError(opened.status)
    }
    let cancelled = false
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller): Promise<void> {
        try {
          await emitCommandCodeChunks(opened.chunks, controller)
        } catch (error) {
          if (!cancelled) controller.enqueue({ type: "error", error })
        } finally {
          lifecycle.dispose()
          if (!cancelled) controller.close()
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
  } catch (error) {
    lifecycle.dispose()
    throw error
  }
}

function emptyUsage(): LanguageModelV3Usage {
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

export function createCommandCodeLanguageModel(
  options: CommandCodeLanguageModelOptions,
): LanguageModelV3 {
  const provider = parseProviderId("command-code")
  const runtime: Runtime = {
    ...options,
    sessionId: createCommandCodeSessionId(options.generateSessionId),
    readCliVersion:
      options.readCliVersion ??
      createCommandCodeVersionResolver({
        env: options.env ?? process.env,
        transport: options.transport,
      }),
  }
  return {
    specificationVersion: "v3",
    provider,
    modelId: options.modelId,
    supportedUrls: {},
    doStream: (call: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> =>
      streamCommandCode(runtime, call),
    doGenerate: async (call: LanguageModelV3CallOptions) => {
      const { stream } = await streamCommandCode(runtime, call)
      const content: LanguageModelV3Content[] = []
      const text: string[] = [],
        reasoning: string[] = []
      let finish: LanguageModelV3FinishReason = { unified: "stop", raw: "stop" }
      let usage = emptyUsage()
      const reader = stream.getReader()
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) break
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
            default:
              break
          }
        }
      } finally {
        await reader.cancel()
        reader.releaseLock()
      }
      if (text.length > 0) content.unshift({ type: "text", text: text.join("") })
      if (reasoning.length > 0) content.unshift({ type: "reasoning", text: reasoning.join("") })
      return { content, finishReason: finish, usage, warnings: [] }
    },
  }
}
