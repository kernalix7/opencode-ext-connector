// Derived from Rahularya01/pi-cursor v1.4.26 request-build.ts. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { InvalidArgumentError } from "../../core/errors.js"
import type { CursorBlobId, CursorBlobStore } from "./blob-store.js"
import type { CursorCheckpointStore } from "./checkpoint-store.js"
import type { ConversationCheckpoint } from "./proto/checkpoint.js"
import { decodeConversationCheckpoint } from "./proto/checkpoint.js"
import type { ConversationAction } from "./proto/context.js"
import { encodeAgentClientMessage } from "./proto/request.js"
import {
  type CursorRequestBlobCollector,
  type CursorRequestBlobOwnership,
  createCursorRequestBlobCollector,
} from "./request-blob-ownership.js"
import {
  buildCursorSelectedContextBlob,
  buildCursorUserMessage,
  type CursorRequestIds,
  normalizeCursorRootPromptBytes,
  storeCursorHistory,
  storeCursorRequestBlob,
} from "./request-history.js"
import { type CursorRunBuildInput, parseCursorRunBuildInput } from "./request-input.js"

export type CursorAgentRunBuildDependencies = {
  readonly blobStore: CursorBlobStore
  readonly checkpointStore: CursorCheckpointStore
  readonly createId: () => string
  readonly input: unknown
}

export type CursorAgentRunBuildResult = {
  readonly kind: "fresh" | "checkpoint"
  readonly bytes: Uint8Array
  readonly blobIds: readonly CursorBlobId[]
  readonly conversationId: string
  readonly ownership: CursorRequestBlobOwnership
}

function emptyCheckpoint(
  rootPromptBlobIds: readonly Uint8Array[],
  turnBlobIds: readonly Uint8Array[],
): ConversationCheckpoint {
  return {
    rootPromptMessageBlobIds: rootPromptBlobIds,
    legacyTurnBlobIds: [],
    todoBlobIds: [],
    pendingToolCalls: [],
    turnBlobIds,
    previousWorkspaceUris: [],
    mode: 1,
    fileStates: [],
    summaryArchiveBlobIds: [],
    turnTimingMessages: [],
    fileStatesV2: [],
    subagentStates: [],
    selfSummaryCount: 0,
    readPaths: [],
    trackedGitRepoBranches: [],
    clientName: "opencode",
  }
}

function buildAction(
  input: CursorRunBuildInput,
  context: {
    readonly selectedContextBlob: Uint8Array
    readonly store: CursorBlobStore
    readonly ownership: CursorRequestBlobCollector
    readonly ids: CursorRequestIds
  },
): ConversationAction {
  switch (input.action.kind) {
    case "user":
      return {
        kind: "user-message",
        userMessage: buildCursorUserMessage(input.action, context),
      }
    case "resume":
      return { kind: "resume", payload: new Uint8Array() }
    case "cancel":
      return { kind: "cancel", payload: new Uint8Array() }
  }
}

function checkpointState(
  input: Extract<CursorRunBuildInput, { readonly mode: "checkpoint" }>,
  checkpointStore: CursorCheckpointStore,
  store: CursorBlobStore,
  ownership: CursorRequestBlobCollector,
): { readonly state: ConversationCheckpoint; readonly selectedContextBlob: Uint8Array } {
  const checkpoint = checkpointStore.resume(input.sessionId)
  if (checkpoint === null) throw new InvalidArgumentError("checkpoint")
  for (const blobId of checkpoint.blobIds) ownership.acquire(blobId)
  const state = decodeConversationCheckpoint(checkpoint.bytes)
  const systemBytes = new TextEncoder().encode(
    JSON.stringify({
      role: "system",
      content: input.rootSystemPrompt.replace(/\r\n?/g, "\n").trim(),
    }),
  )
  const systemBlobId = storeCursorRequestBlob(store, ownership, systemBytes)
  const selectedContextBlob = storeCursorRequestBlob(
    store,
    ownership,
    buildCursorSelectedContextBlob(systemBlobId),
  )
  if (input.refreshRootPrompt !== true) return { state, selectedContextBlob }
  return {
    state: {
      ...state,
      rootPromptMessageBlobIds: [
        ...state.rootPromptMessageBlobIds,
        storeCursorRequestBlob(
          store,
          ownership,
          normalizeCursorRootPromptBytes(input.rootSystemPrompt),
        ),
      ],
    },
    selectedContextBlob,
  }
}

export function normalizeCursorRootPrompt(prompt: string): Uint8Array {
  return normalizeCursorRootPromptBytes(prompt)
}

export function buildCursorAgentRunRequest(
  dependencies: CursorAgentRunBuildDependencies,
): CursorAgentRunBuildResult {
  const input = parseCursorRunBuildInput(dependencies.input)
  const ownership = createCursorRequestBlobCollector(dependencies.blobStore)
  const ids = { create: dependencies.createId }
  try {
    const prepared =
      input.mode === "fresh"
        ? (() => {
            const history = storeCursorHistory({
              turns: input.history,
              systemPrompt: input.rootSystemPrompt.replace(/\r\n?/g, "\n").trim(),
              store: dependencies.blobStore,
              ownership,
              ids,
            })
            return {
              state: emptyCheckpoint(history.rootPromptBlobIds, history.turnBlobIds),
              selectedContextBlob: history.selectedContextBlob,
            }
          })()
        : checkpointState(input, dependencies.checkpointStore, dependencies.blobStore, ownership)
    const bytes = encodeAgentClientMessage({
      kind: "run-request",
      request: {
        conversationState: prepared.state,
        action: buildAction(input, {
          selectedContextBlob: prepared.selectedContextBlob,
          store: dependencies.blobStore,
          ownership,
          ids,
        }),
        mcpTools: input.mcpTools,
        conversationId: input.conversationId,
        requestedModel: {
          modelId: input.modelId,
          maxMode: input.maxMode ?? false,
          parameters: input.modelParameters,
        },
      },
    })
    const owned = ownership.finish()
    return Object.freeze({
      kind: input.mode,
      bytes: new Uint8Array(bytes),
      blobIds: owned.blobIds,
      conversationId: input.conversationId,
      ownership: owned,
    })
  } catch (error) {
    ownership.rollback()
    throw error
  }
}
