// Derived from Rahularya01/pi-cursor proto/agent.proto ConversationStateStructure. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  decodeUtf8Strict,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
} from "../proto-wire"
import {
  assertKnownFields,
  optionalField,
  optionalString,
  optionalUint32,
  repeatedFields,
  requiredField,
  requiredString,
} from "./fields"
import { encodeUnknownField } from "./unknown-field"

export type CheckpointMapEntry = {
  readonly key: string
  readonly value: Uint8Array
}

export type ConversationTokenDetails = {
  readonly usedTokens: number
  readonly maxTokens: number
  readonly breakdown?: Uint8Array
}

export type ConversationCheckpoint = {
  readonly rootPromptMessageBlobIds: readonly Uint8Array[]
  readonly legacyTurnBlobIds: readonly Uint8Array[]
  readonly todoBlobIds: readonly Uint8Array[]
  readonly pendingToolCalls: readonly string[]
  readonly tokenDetails?: ConversationTokenDetails
  readonly summaryBlob?: Uint8Array
  readonly planBlob?: Uint8Array
  readonly turnBlobIds: readonly Uint8Array[]
  readonly previousWorkspaceUris: readonly string[]
  readonly mode?: number
  readonly summaryArchiveBlob?: Uint8Array
  readonly fileStates: readonly CheckpointMapEntry[]
  readonly summaryArchiveBlobIds: readonly Uint8Array[]
  readonly turnTimingMessages: readonly Uint8Array[]
  readonly fileStatesV2: readonly CheckpointMapEntry[]
  readonly subagentStates: readonly CheckpointMapEntry[]
  readonly selfSummaryCount?: number
  readonly readPaths: readonly string[]
  readonly trackedGitRepoBranches: readonly Uint8Array[]
  readonly clientName?: string
  readonly conversationStartedTimestampMs?: Uint8Array
  readonly conversationStartedTimeZone?: string
}

function decodeTokenDetails(bytes: Uint8Array): ConversationTokenDetails {
  const context = "ConversationTokenDetails"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3], context)
  const breakdown = optionalField(fields, { context, field: 3, wire: 2 })
  return {
    usedTokens: optionalUint32(fields, { context, field: 1, wire: 0 }) ?? 0,
    maxTokens: optionalUint32(fields, { context, field: 2, wire: 0 }) ?? 0,
    ...(breakdown === undefined ? {} : { breakdown: breakdown.bytes }),
  }
}

function encodeTokenDetails(details: ConversationTokenDetails): Uint8Array {
  return concatBytes([
    ...(details.usedTokens === 0 ? [] : [encodeInt32Field(1, details.usedTokens)]),
    ...(details.maxTokens === 0 ? [] : [encodeInt32Field(2, details.maxTokens)]),
    ...(details.breakdown === undefined ? [] : [encodeBytesField(3, details.breakdown)]),
  ])
}

function decodeMapEntry(bytes: Uint8Array, context: string): CheckpointMapEntry {
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2], context)
  return {
    key: requiredString(fields, { context, field: 1, wire: 2 }),
    value: requiredField(fields, { context, field: 2, wire: 2 }).bytes,
  }
}

function encodeMapEntry(entry: CheckpointMapEntry): Uint8Array {
  return concatBytes([encodeStringField(1, entry.key), encodeBytesField(2, entry.value)])
}

function repeatedBytes(
  fields: ReturnType<typeof decodeFieldsStrict>,
  field: number,
  context: string,
): readonly Uint8Array[] {
  return repeatedFields(fields, { context, field, wire: 2 }).map((entry) => entry.bytes)
}

function repeatedStrings(
  fields: ReturnType<typeof decodeFieldsStrict>,
  field: number,
  context: string,
): readonly string[] {
  return repeatedFields(fields, { context, field, wire: 2 }).map((entry) =>
    decodeUtf8Strict(entry.bytes, `${context} field ${field}`),
  )
}

export function decodeConversationCheckpoint(bytes: Uint8Array): ConversationCheckpoint {
  const context = "ConversationStateStructure"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(
    fields,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 26, 27],
    context,
  )
  const tokenDetails = optionalField(fields, { context, field: 5, wire: 2 })
  const summaryBlob = optionalField(fields, { context, field: 6, wire: 2 })
  const planBlob = optionalField(fields, { context, field: 7, wire: 2 })
  const summaryArchiveBlob = optionalField(fields, { context, field: 11, wire: 2 })
  const mode = optionalUint32(fields, { context, field: 10, wire: 0 })
  const selfSummaryCount = optionalUint32(fields, { context, field: 17, wire: 0 })
  const clientName = optionalString(fields, { context, field: 22, wire: 2 })
  const conversationStartedTimestampMs = optionalField(fields, { context, field: 26, wire: 0 })
  const conversationStartedTimeZone = optionalString(fields, { context, field: 27, wire: 2 })
  return {
    rootPromptMessageBlobIds: repeatedBytes(fields, 1, context),
    legacyTurnBlobIds: repeatedBytes(fields, 2, context),
    todoBlobIds: repeatedBytes(fields, 3, context),
    pendingToolCalls: repeatedStrings(fields, 4, context),
    ...(tokenDetails === undefined ? {} : { tokenDetails: decodeTokenDetails(tokenDetails.bytes) }),
    ...(summaryBlob === undefined ? {} : { summaryBlob: summaryBlob.bytes }),
    ...(planBlob === undefined ? {} : { planBlob: planBlob.bytes }),
    turnBlobIds: repeatedBytes(fields, 8, context),
    previousWorkspaceUris: repeatedStrings(fields, 9, context),
    ...(mode === undefined ? {} : { mode }),
    ...(summaryArchiveBlob === undefined ? {} : { summaryArchiveBlob: summaryArchiveBlob.bytes }),
    fileStates: repeatedBytes(fields, 12, context).map((entry) =>
      decodeMapEntry(entry, "ConversationStateStructure.file_states"),
    ),
    summaryArchiveBlobIds: repeatedBytes(fields, 13, context),
    turnTimingMessages: repeatedBytes(fields, 14, context),
    fileStatesV2: repeatedBytes(fields, 15, context).map((entry) =>
      decodeMapEntry(entry, "ConversationStateStructure.file_states_v2"),
    ),
    subagentStates: repeatedBytes(fields, 16, context).map((entry) =>
      decodeMapEntry(entry, "ConversationStateStructure.subagent_states"),
    ),
    ...(selfSummaryCount === undefined ? {} : { selfSummaryCount }),
    readPaths: repeatedStrings(fields, 18, context),
    trackedGitRepoBranches: repeatedBytes(fields, 21, context),
    ...(clientName === undefined ? {} : { clientName }),
    ...(conversationStartedTimestampMs === undefined
      ? {}
      : { conversationStartedTimestampMs: conversationStartedTimestampMs.bytes }),
    ...(conversationStartedTimeZone === undefined ? {} : { conversationStartedTimeZone }),
  }
}

export function encodeConversationCheckpoint(state: ConversationCheckpoint): Uint8Array {
  return concatBytes([
    ...state.rootPromptMessageBlobIds.map((value) => encodeBytesField(1, value)),
    ...state.legacyTurnBlobIds.map((value) => encodeBytesField(2, value)),
    ...state.todoBlobIds.map((value) => encodeBytesField(3, value)),
    ...state.pendingToolCalls.map((value) => encodeStringField(4, value)),
    ...(state.tokenDetails === undefined
      ? []
      : [encodeBytesField(5, encodeTokenDetails(state.tokenDetails))]),
    ...(state.summaryBlob === undefined ? [] : [encodeBytesField(6, state.summaryBlob)]),
    ...(state.planBlob === undefined ? [] : [encodeBytesField(7, state.planBlob)]),
    ...state.turnBlobIds.map((value) => encodeBytesField(8, value)),
    ...state.previousWorkspaceUris.map((value) => encodeStringField(9, value)),
    ...(state.mode === undefined ? [] : [encodeInt32Field(10, state.mode)]),
    ...(state.summaryArchiveBlob === undefined
      ? []
      : [encodeBytesField(11, state.summaryArchiveBlob)]),
    ...state.fileStates.map((entry) => encodeBytesField(12, encodeMapEntry(entry))),
    ...state.summaryArchiveBlobIds.map((value) => encodeBytesField(13, value)),
    ...state.turnTimingMessages.map((value) => encodeBytesField(14, value)),
    ...state.fileStatesV2.map((entry) => encodeBytesField(15, encodeMapEntry(entry))),
    ...state.subagentStates.map((entry) => encodeBytesField(16, encodeMapEntry(entry))),
    ...(state.selfSummaryCount === undefined ? [] : [encodeInt32Field(17, state.selfSummaryCount)]),
    ...state.readPaths.map((value) => encodeStringField(18, value)),
    ...state.trackedGitRepoBranches.map((value) => encodeBytesField(21, value)),
    ...(state.clientName === undefined ? [] : [encodeStringField(22, state.clientName)]),
    ...(state.conversationStartedTimestampMs === undefined
      ? []
      : [encodeUnknownField(26, 0, state.conversationStartedTimestampMs)]),
    ...(state.conversationStartedTimeZone === undefined
      ? []
      : [encodeStringField(27, state.conversationStartedTimeZone)]),
  ])
}
