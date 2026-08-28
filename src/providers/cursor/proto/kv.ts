// Derived from Rahularya01/pi-cursor proto/agent.proto KV blob messages. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
} from "../proto-wire"
import { CursorProtocolDriftError, unreachableVariant } from "./errors"
import {
  assertKnownFields,
  oneofField,
  optionalField,
  optionalUint32,
  requiredField,
  requiredString,
  requiredUint32,
} from "./fields"

export type KvServerMessage =
  | {
      readonly kind: "get-blob"
      readonly id: number
      readonly blobId: Uint8Array
      readonly spanContext?: Uint8Array
    }
  | {
      readonly kind: "set-blob"
      readonly id: number
      readonly blobId: Uint8Array
      readonly blobData: Uint8Array
      readonly spanContext?: Uint8Array
    }

export type KvClientMessage =
  | { readonly kind: "get-blob-result"; readonly id: number; readonly blobData?: Uint8Array }
  | { readonly kind: "set-blob-result"; readonly id: number; readonly error?: string }

export function decodeKvServerMessage(bytes: Uint8Array): KvServerMessage {
  const context = "KvServerMessage"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4], context)
  const id = optionalUint32(fields, { context, field: 1, wire: 0 }) ?? 0
  const span = optionalField(fields, { context, field: 4, wire: 2 })
  const message = oneofField(fields, [2, 3], context)
  const nestedContext = message.field === 2 ? "GetBlobArgs" : "SetBlobArgs"
  const nested = decodeFieldsStrict(message.bytes, { context: nestedContext })
  switch (message.field) {
    case 2:
      assertKnownFields(nested, [1], nestedContext)
      return {
        kind: "get-blob",
        id,
        blobId: requiredField(nested, { context: nestedContext, field: 1, wire: 2 }).bytes,
        ...(span === undefined ? {} : { spanContext: span.bytes }),
      }
    case 3:
      assertKnownFields(nested, [1, 2], nestedContext)
      return {
        kind: "set-blob",
        id,
        blobId: requiredField(nested, { context: nestedContext, field: 1, wire: 2 }).bytes,
        blobData: requiredField(nested, { context: nestedContext, field: 2, wire: 2 }).bytes,
        ...(span === undefined ? {} : { spanContext: span.bytes }),
      }
    default:
      throw new CursorProtocolDriftError(context, message.field)
  }
}

export function encodeKvServerMessage(message: KvServerMessage): Uint8Array {
  switch (message.kind) {
    case "get-blob":
      return concatBytes([
        encodeInt32Field(1, message.id),
        encodeBytesField(2, encodeBytesField(1, message.blobId)),
        ...(message.spanContext === undefined ? [] : [encodeBytesField(4, message.spanContext)]),
      ])
    case "set-blob":
      return concatBytes([
        encodeInt32Field(1, message.id),
        encodeBytesField(
          3,
          concatBytes([encodeBytesField(1, message.blobId), encodeBytesField(2, message.blobData)]),
        ),
        ...(message.spanContext === undefined ? [] : [encodeBytesField(4, message.spanContext)]),
      ])
    default:
      return unreachableVariant(message, "KvServerMessage")
  }
}

export function decodeKvClientMessage(bytes: Uint8Array): KvClientMessage {
  const context = "KvClientMessage"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3], context)
  const id = requiredUint32(fields, { context, field: 1, wire: 0 })
  const message = oneofField(fields, [2, 3], context)
  const nestedContext = message.field === 2 ? "GetBlobResult" : "SetBlobResult"
  const nested = decodeFieldsStrict(message.bytes, { context: nestedContext })
  switch (message.field) {
    case 2: {
      assertKnownFields(nested, [1], nestedContext)
      const blobData = optionalField(nested, { context: nestedContext, field: 1, wire: 2 })
      return {
        kind: "get-blob-result",
        id,
        ...(blobData === undefined ? {} : { blobData: blobData.bytes }),
      }
    }
    case 3: {
      assertKnownFields(nested, [1], nestedContext)
      const error = optionalField(nested, { context: nestedContext, field: 1, wire: 2 })
      if (error === undefined) {
        return { kind: "set-blob-result", id }
      }
      const errorContext = "Error"
      const errorFields = decodeFieldsStrict(error.bytes, { context: errorContext })
      assertKnownFields(errorFields, [1], errorContext)
      return {
        kind: "set-blob-result",
        id,
        error: requiredString(errorFields, { context: errorContext, field: 1, wire: 2 }),
      }
    }
    default:
      throw new CursorProtocolDriftError(context, message.field)
  }
}

export function encodeKvClientMessage(message: KvClientMessage): Uint8Array {
  switch (message.kind) {
    case "get-blob-result":
      return concatBytes([
        encodeInt32Field(1, message.id),
        encodeBytesField(
          2,
          message.blobData === undefined ? new Uint8Array() : encodeBytesField(1, message.blobData),
        ),
      ])
    case "set-blob-result":
      return concatBytes([
        encodeInt32Field(1, message.id),
        encodeBytesField(
          3,
          message.error === undefined
            ? new Uint8Array()
            : encodeBytesField(1, encodeStringField(1, message.error)),
        ),
      ])
    default:
      return unreachableVariant(message, "KvClientMessage")
  }
}
