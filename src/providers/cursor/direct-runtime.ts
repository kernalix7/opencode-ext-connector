import { randomUUID } from "node:crypto"

import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider"

import type { Clock } from "../../core/clock.js"
import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import { parseProviderId } from "../../core/ids.js"
import { createAsyncDisposable } from "../../core/lifecycle.js"
import { type CursorBridgeClient, createCursorBridgeClient } from "./bridge-client.js"
import { startCursorDirectRun } from "./direct-run.js"
import type {
  CursorDirectSetupCleanup,
  CursorDirectSetupCleanupResources,
} from "./direct-run-types.js"
import { consumeCursorDirectSession } from "./direct-stream.js"
import type { CursorMcpTool } from "./mcp-tools.js"
import { createCursorRunSessionRegistry } from "./run-session.js"
import type { CursorRunSessionBackgroundCleanupErrorHandler } from "./run-session-expiry.js"
import { settleCursorCleanup } from "./settle-cleanup.js"
import { buildCursorToolContinuations } from "./tool-continuation.js"

export type {
  CursorDirectSetupCleanup,
  CursorDirectSetupCleanupResources,
} from "./direct-run-types.js"

export type CursorDirectRuntimeOptions = {
  readonly clock: Clock
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly onBackgroundCleanupError: CursorRunSessionBackgroundCleanupErrorHandler
  readonly createBridgeClient?: (signal: AbortSignal) => Promise<CursorBridgeClient>
  readonly createId?: () => string
  readonly ttlMs?: number
  readonly idleTimeoutMs?: number
  readonly createSetupCleanup?: (
    resources: CursorDirectSetupCleanupResources,
  ) => CursorDirectSetupCleanup
}

export type CursorDirectRuntime = {
  readonly doStream: (
    call: LanguageModelV3CallOptions,
    modelId: string,
  ) => Promise<{ readonly stream: ReadableStream<LanguageModelV3StreamPart> }>
  readonly dispose: () => Promise<void>
}

function toolsFromCall(call: LanguageModelV3CallOptions): readonly CursorMcpTool[] {
  return (call.tools ?? [])
    .filter((tool) => tool.type === "function")
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }))
}

function cursorFailure(operation: string): AdapterError {
  return new AdapterError({
    operation,
    retryable: false,
    cause: null,
    providerId: parseProviderId("cursor"),
  })
}

export function createCursorDirectRuntime(
  options: CursorDirectRuntimeOptions,
): CursorDirectRuntime {
  const lifecycle = new AbortController()
  const createId = options.createId ?? randomUUID
  const registry = createCursorRunSessionRegistry({
    clock: options.clock,
    ttlMs: options.ttlMs ?? 300_000,
    onBackgroundCleanupError: options.onBackgroundCleanupError,
  })
  let bridgeClient: Promise<CursorBridgeClient> | null = null
  const bridge = (): Promise<CursorBridgeClient> => {
    bridgeClient ??=
      options.createBridgeClient?.(lifecycle.signal) ??
      createCursorBridgeClient({ signal: lifecycle.signal })
    return bridgeClient
  }
  const doStream = async (call: LanguageModelV3CallOptions, modelId: string) => {
    const signal = call.abortSignal ?? new AbortController().signal
    if (signal.aborted) throw new OperationCancelledError("cursor-direct-stream")
    const resultCallIds: string[] = []
    for (let index = call.prompt.length - 1; index >= 0; index -= 1) {
      const message = call.prompt[index]
      if (message?.role !== "tool") break
      resultCallIds.unshift(
        ...message.content
          .filter((part) => part.type === "tool-result")
          .map((part) => part.toolCallId),
      )
    }
    if (resultCallIds.length > 0) {
      const existing = registry.resolveParkedCalls(resultCallIds, modelId)
      const continuations = buildCursorToolContinuations(
        call.prompt,
        existing.dispatcher.parkedCalls,
      )
      await existing.writeContinuations(continuations, signal)
      return { stream: await consumeCursorDirectSession({ session: existing, signal, registry }) }
    }
    const setup = new AbortController()
    const cancel = (): void => {
      if (!setup.signal.aborted) {
        setup.abort(new OperationCancelledError("cursor-direct-stream"))
      }
    }
    lifecycle.signal.addEventListener("abort", cancel, { once: true })
    call.abortSignal?.addEventListener("abort", cancel, { once: true })
    if (lifecycle.signal.aborted || signal.aborted) cancel()
    try {
      const token = await options.readAccessToken(setup.signal)
      if (setup.signal.aborted) throw new OperationCancelledError("cursor-direct-stream")
      if (token === null) throw cursorFailure("cursor-auth-unavailable")
      return await startCursorDirectRun({
        bridge: await bridge(),
        call,
        clock: options.clock,
        createId,
        idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
        modelId,
        registry,
        signal,
        token,
        tools: toolsFromCall(call),
        ttlMs: options.ttlMs ?? 300_000,
        ...(options.createSetupCleanup === undefined
          ? {}
          : { createSetupCleanup: options.createSetupCleanup }),
      })
    } finally {
      lifecycle.signal.removeEventListener("abort", cancel)
      call.abortSignal?.removeEventListener("abort", cancel)
    }
  }
  const disposal = createAsyncDisposable(async () => {
    lifecycle.abort()
    await settleCursorCleanup([
      registry.dispose,
      async () => {
        const client = await bridgeClient
        await client?.dispose()
      },
    ])
  })
  return { doStream, dispose: disposal.dispose }
}
