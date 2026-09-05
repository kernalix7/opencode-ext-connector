import type { CursorBlobId } from "./blob-store.js"
import { parseCursorWireBlobId } from "./blob-store.js"
import {
  cursorMcpDefinitions,
  encodeCursorClientFrame,
  encodeNativeRejectFrame,
  encodeRequestContextFrame,
} from "./exec-reply.js"
import { buildCursorInteractionReply } from "./interaction-reply.js"
import { type ConversationCheckpoint, encodeConversationCheckpoint } from "./proto/checkpoint.js"
import type { AgentServerMessage } from "./proto/server.js"
import { decodeAgentServerMessage } from "./proto/server.js"
import type {
  CursorDispatchOutcome,
  CursorDispatchResult,
  CursorServerDispatcher,
  CursorServerDispatcherOptions,
  ParkedMcpCall,
} from "./server-dispatch-types.js"

export type {
  CursorDispatchOutcome,
  CursorDispatchResult,
  CursorServerDispatcher,
  CursorServerDispatcherOptions,
  ParkedMcpCall,
} from "./server-dispatch-types.js"

function result(
  outcome: CursorDispatchOutcome,
  replyFrames: readonly Uint8Array[] = [],
): CursorDispatchResult {
  return { outcome, replyFrames, closeStream: false }
}

function checkpointBlobIds(checkpoint: ConversationCheckpoint): readonly Uint8Array[] {
  return [
    ...checkpoint.rootPromptMessageBlobIds,
    ...checkpoint.legacyTurnBlobIds,
    ...checkpoint.todoBlobIds,
    ...checkpoint.turnBlobIds,
    ...checkpoint.summaryArchiveBlobIds,
  ]
}

export function createCursorServerDispatcher(
  options: CursorServerDispatcherOptions,
): CursorServerDispatcher {
  const parkedCalls = new Map<string, ParkedMcpCall>()

  const dispatchUpdate = (
    update: Extract<AgentServerMessage, { readonly kind: "interaction-update" }>["update"],
  ): CursorDispatchResult => {
    switch (update.kind) {
      case "text-delta":
        return result({ kind: "text", text: update.text })
      case "thinking-delta":
        return result({ kind: "thinking", text: update.text })
      case "token-delta":
        return result({ kind: "tokens", tokens: update.tokens })
      case "turn-ended":
        return result({ kind: "turn-ended" })
      case "heartbeat":
        return result({ kind: "heartbeat" })
      case "tool-call-started":
      case "tool-call-completed":
      case "thinking-completed":
      case "user-message-appended":
      case "partial-tool-call":
      case "summary":
      case "summary-started":
      case "summary-completed":
      case "shell-output-delta":
      case "tool-call-delta":
      case "step-started":
      case "step-completed":
      case "field-25":
        return result({ kind: "telemetry", name: update.kind })
      default:
        return update satisfies never
    }
  }

  const dispatchKv = (
    message: Extract<AgentServerMessage, { readonly kind: "kv-server-message" }>["message"],
  ): CursorDispatchResult => {
    const blobId = parseCursorWireBlobId(message.blobId)
    switch (message.kind) {
      case "get-blob": {
        const blobData = options.blobStore.get(blobId)
        const reply = encodeCursorClientFrame({
          kind: "kv-client-message",
          message: {
            kind: "get-blob-result",
            id: message.id,
            ...(blobData === null ? {} : { blobData }),
          },
        })
        return result({ kind: "kv-get", id: message.id, found: blobData !== null }, [reply])
      }
      case "set-blob": {
        const matches = options.blobStore.hash(message.blobData) === blobId
        const stored = matches && options.blobStore.putVerified(blobId, message.blobData) !== null
        const reply = encodeCursorClientFrame({
          kind: "kv-client-message",
          message: {
            kind: "set-blob-result",
            id: message.id,
            ...(stored ? {} : { error: matches ? "blob-store-full" : "blob-id-mismatch" }),
          },
        })
        return result({ kind: "kv-set", id: message.id, stored }, [reply])
      }
      default:
        return message satisfies never
    }
  }

  const dispatchExec = (
    message: Extract<AgentServerMessage, { readonly kind: "exec-server-message" }>["message"],
  ): CursorDispatchResult => {
    switch (message.kind) {
      case "metadata":
        return result({ kind: "telemetry", name: message.kind })
      case "request-context-args":
        return result({ kind: "request-context-replied", id: message.id, execId: message.execId }, [
          encodeRequestContextFrame(message, options.tools),
        ])
      case "mcp-args": {
        const callId = message.args.toolCallId
        const toolNames = new Set(
          cursorMcpDefinitions(options.tools).flatMap((tool) => [tool.name, tool.toolName]),
        )
        if (callId === "" || parkedCalls.has(callId)) {
          return result({
            kind: "drift",
            area: "mcp-call",
            detail: callId === "" ? "missing-call-id" : "duplicate-call-id",
            stranding: true,
          })
        }
        const requestedName = message.args.toolName || message.args.name
        if (!toolNames.has(requestedName)) {
          const reply = encodeCursorClientFrame({
            kind: "exec-client-message",
            message: {
              kind: "mcp-result",
              id: message.id,
              execId: message.execId,
              result: {
                kind: "tool-not-found",
                name: requestedName,
                availableTools: [...toolNames],
              },
            },
          })
          return result({ kind: "mcp-rejected", callId }, [reply])
        }
        const parked: ParkedMcpCall = {
          callId,
          execId: message.execId,
          execMessageId: message.id,
          args: message.args,
        }
        parkedCalls.set(callId, parked)
        return result({ kind: "mcp-parked", parked })
      }
      case "native":
        return result({ kind: "native-rejected", operation: message.operation }, [
          encodeNativeRejectFrame(message),
        ])
      default:
        return message satisfies never
    }
  }

  const dispatch = (message: AgentServerMessage): CursorDispatchResult => {
    switch (message.kind) {
      case "interaction-update":
        return dispatchUpdate(message.update)
      case "kv-server-message":
        return dispatchKv(message.message)
      case "exec-server-message":
        return dispatchExec(message.message)
      case "conversation-checkpoint-update": {
        const blobIds: CursorBlobId[] = checkpointBlobIds(message.checkpoint).map(
          parseCursorWireBlobId,
        )
        const stored = options.checkpointStore.update({
          sessionId: options.sessionId,
          bytes: encodeConversationCheckpoint(message.checkpoint),
          blobIds,
        })
        return result({ kind: "checkpoint", stored })
      }
      case "interaction-query": {
        const interactionReply = buildCursorInteractionReply(message.query)
        const reply = encodeCursorClientFrame({
          kind: "interaction-response",
          response: interactionReply.response,
        })
        return result(
          { kind: "interaction-replied", id: message.query.id, action: interactionReply.action },
          [reply],
        )
      }
      case "exec-server-control":
        return result({ kind: "control", control: message.control.kind, id: message.control.id })
      case "unknown-oneof":
        return result({
          kind: "drift",
          area: "server-message",
          detail: `field-${message.field}`,
          stranding: message.drift.stranding,
        })
      default:
        return message satisfies never
    }
  }

  return {
    dispatch,
    dispatchBytes: (bytes): CursorDispatchResult => dispatch(decodeAgentServerMessage(bytes)),
    parkedCalls,
  }
}
