import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

import type { Clock } from "../../core/clock.js"
import type { CursorBridgeClient } from "./bridge-client.js"
import type { CursorCheckpointStore } from "./checkpoint-store.js"
import type { CursorMcpTool } from "./mcp-tools.js"
import type { CursorRequestBlobOwnership } from "./request-blob-ownership.js"
import type { CursorRunSessionRegistry } from "./run-session.js"
import type { CursorSessionId, CursorSessionStateStore } from "./session-state.js"

export type CursorDirectSetupCleanupResources = {
  readonly checkpointStore: CursorCheckpointStore
  readonly ownership: CursorRequestBlobOwnership
  readonly sessionId: CursorSessionId
  readonly sessionStore: CursorSessionStateStore
}

export type CursorDirectSetupCleanup = {
  readonly releaseOwnership: () => void
  readonly invalidateCheckpoint: () => void
  readonly invalidateSession: () => void
}

export type CursorDirectRunOptions = {
  readonly bridge: CursorBridgeClient
  readonly call: LanguageModelV3CallOptions
  readonly clock: Clock
  readonly createId: () => string
  readonly createSetupCleanup?: (
    resources: CursorDirectSetupCleanupResources,
  ) => CursorDirectSetupCleanup
  readonly idleTimeoutMs: number
  readonly modelId: string
  readonly registry: CursorRunSessionRegistry
  readonly signal: AbortSignal
  readonly token: string
  readonly tools: readonly CursorMcpTool[]
  readonly ttlMs: number
}
