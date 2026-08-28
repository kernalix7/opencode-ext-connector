import type { CursorBlobStore } from "./blob-store"
import type { CursorCheckpointStore } from "./checkpoint-store"
import type { CursorMcpTool } from "./mcp-tools"
import type { McpArgs } from "./proto/mcp"
import type { AgentServerMessage } from "./proto/server"
import type { CursorSessionId } from "./session-state"

export type ParkedMcpCall = {
  readonly callId: string
  readonly execId: string
  readonly execMessageId: number
  readonly args: McpArgs
}

export type CursorDispatchOutcome =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "tokens"; readonly tokens: number }
  | { readonly kind: "turn-ended" }
  | { readonly kind: "heartbeat" }
  | { readonly kind: "telemetry"; readonly name: string }
  | { readonly kind: "kv-get"; readonly id: number; readonly found: boolean }
  | { readonly kind: "kv-set"; readonly id: number; readonly stored: boolean }
  | { readonly kind: "checkpoint"; readonly stored: boolean }
  | { readonly kind: "request-context-replied"; readonly id: number; readonly execId: string }
  | { readonly kind: "mcp-parked"; readonly parked: ParkedMcpCall }
  | { readonly kind: "mcp-rejected"; readonly callId: string }
  | { readonly kind: "native-rejected"; readonly operation: string }
  | {
      readonly kind: "interaction-replied"
      readonly id: number
      readonly action: "rejected" | "acked"
    }
  | { readonly kind: "control"; readonly control: "abort"; readonly id: number }
  | {
      readonly kind: "drift"
      readonly area: "server-message" | "mcp-call"
      readonly detail: string
      readonly stranding: boolean
    }

export type CursorDispatchResult = {
  readonly outcome: CursorDispatchOutcome
  readonly replyFrames: readonly Uint8Array[]
  readonly closeStream: boolean
}

export type CursorServerDispatcherOptions = {
  readonly blobStore: CursorBlobStore
  readonly checkpointStore: CursorCheckpointStore
  readonly sessionId: CursorSessionId
  readonly tools: readonly CursorMcpTool[]
}

export type CursorServerDispatcher = {
  readonly dispatch: (message: AgentServerMessage) => CursorDispatchResult
  readonly dispatchBytes: (bytes: Uint8Array) => CursorDispatchResult
  /** Mutable unresolved-call state; retirement is part of successful continuation commit. */
  readonly parkedCalls: Map<string, ParkedMcpCall>
}
