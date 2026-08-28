import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

import type { Clock } from "../../core/clock"
import type { CursorBridgeClient } from "./bridge-client"
import type { CursorCheckpointStore } from "./checkpoint-store"
import type { CursorMcpTool } from "./mcp-tools"
import type { CursorRequestBlobOwnership } from "./request-blob-ownership"
import type { CursorRunSessionRegistry } from "./run-session"
import type { CursorSessionId, CursorSessionStateStore } from "./session-state"

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
