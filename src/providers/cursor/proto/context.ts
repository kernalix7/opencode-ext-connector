// Derived from Rahularya01/pi-cursor proto/agent.proto conversation context fields. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  decodeUtf8Strict,
  encodeBoolField,
  encodeBytesField,
  encodeInt32Field,
  encodeStringField,
} from "../proto-wire.js"
import { CursorProtocolError, unreachableVariant } from "./errors.js"
import {
  assertKnownFields,
  oneofField,
  optionalBool,
  optionalField,
  optionalString,
  repeatedFields,
  requiredField,
  requiredString,
  requiredUint32,
} from "./fields.js"

export type SelectedImageData =
  | { readonly kind: "blob-id"; readonly bytes: Uint8Array }
  | { readonly kind: "data"; readonly bytes: Uint8Array }
  | { readonly kind: "blob-id-with-data"; readonly blobId: Uint8Array; readonly bytes: Uint8Array }

export type SelectedImage = {
  readonly uuid: string
  readonly path: string
  readonly mimeType: string
  readonly data: SelectedImageData
}

export type SelectedContext = {
  readonly selectedImages: readonly SelectedImage[]
  readonly extraContext: readonly string[]
}

export type UserMessage = {
  readonly text: string
  readonly messageId: string
  readonly selectedContext?: SelectedContext
  readonly mode: number
  readonly isSimulatedMessage?: boolean
  readonly bestOfNGroupId?: string
  readonly tryUseBestOfNPromotion?: boolean
  readonly richText?: string
  readonly selectedContextBlob: Uint8Array
  readonly correlationId: string
}

export type ConversationAction =
  | {
      readonly kind: "user-message"
      readonly userMessage?: UserMessage
      readonly requestContextBytes?: Uint8Array
      readonly sendToInteractionListener?: boolean
    }
  | { readonly kind: "resume"; readonly payload: Uint8Array }
  | { readonly kind: "cancel"; readonly payload: Uint8Array }
  | { readonly kind: "summarize"; readonly payload: Uint8Array }
  | { readonly kind: "shell-command"; readonly payload: Uint8Array }
  | { readonly kind: "start-plan"; readonly payload: Uint8Array }
  | { readonly kind: "execute-plan"; readonly payload: Uint8Array }
  | { readonly kind: "async-ask-question-completion"; readonly payload: Uint8Array }

function decodeImageData(bytes: Uint8Array, field: number): SelectedImageData {
  switch (field) {
    case 1:
      return { kind: "blob-id", bytes }
    case 8:
      return { kind: "data", bytes }
    case 9: {
      const context = "SelectedImage.BlobIdWithData"
      const fields = decodeFieldsStrict(bytes, { context })
      assertKnownFields(fields, [1, 2], context)
      return {
        kind: "blob-id-with-data",
        blobId: requiredField(fields, { context, field: 1, wire: 2 }).bytes,
        bytes: requiredField(fields, { context, field: 2, wire: 2 }).bytes,
      }
    }
    default:
      throw new CursorProtocolError("malformed", "SelectedImage", "image data variant is absent")
  }
}

function encodeImageData(data: SelectedImageData): Uint8Array {
  switch (data.kind) {
    case "blob-id":
      return encodeBytesField(1, data.bytes)
    case "data":
      return encodeBytesField(8, data.bytes)
    case "blob-id-with-data":
      return encodeBytesField(
        9,
        concatBytes([encodeBytesField(1, data.blobId), encodeBytesField(2, data.bytes)]),
      )
    default:
      return unreachableVariant(data, "SelectedImage.data")
  }
}

function decodeSelectedImage(bytes: Uint8Array): SelectedImage {
  const context = "SelectedImage"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 7, 8, 9], context)
  const data = oneofField(fields, [1, 8, 9], context)
  return {
    uuid: requiredString(fields, { context, field: 2, wire: 2 }),
    path: optionalString(fields, { context, field: 3, wire: 2 }) ?? "",
    mimeType: requiredString(fields, { context, field: 7, wire: 2 }),
    data: decodeImageData(data.bytes, data.field),
  }
}

function encodeSelectedImage(image: SelectedImage): Uint8Array {
  return concatBytes([
    encodeImageData(image.data),
    encodeStringField(2, image.uuid),
    ...(image.path === "" ? [] : [encodeStringField(3, image.path)]),
    encodeStringField(7, image.mimeType),
  ])
}

export function decodeSelectedContext(bytes: Uint8Array): SelectedContext {
  const context = "SelectedContext"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 3], context)
  return {
    selectedImages: repeatedFields(fields, { context, field: 1, wire: 2 }).map((entry) =>
      decodeSelectedImage(entry.bytes),
    ),
    extraContext: repeatedFields(fields, { context, field: 3, wire: 2 }).map((entry) =>
      decodeUtf8Strict(entry.bytes, `${context} field 3`),
    ),
  }
}

export function encodeSelectedContext(context: SelectedContext): Uint8Array {
  return concatBytes([
    ...context.selectedImages.map((image) => encodeBytesField(1, encodeSelectedImage(image))),
    ...context.extraContext.map((value) => encodeStringField(3, value)),
  ])
}

function decodeUserMessage(bytes: Uint8Array): UserMessage {
  const context = "UserMessage"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5, 6, 7, 8, 10, 17], context)
  const selectedContext = optionalField(fields, { context, field: 3, wire: 2 })
  const isSimulatedMessage = optionalBool(fields, { context, field: 5, wire: 0 })
  const bestOfNGroupId = optionalString(fields, { context, field: 6, wire: 2 })
  const tryUseBestOfNPromotion = optionalBool(fields, { context, field: 7, wire: 0 })
  const richText = optionalString(fields, { context, field: 8, wire: 2 })
  const base = {
    text: requiredString(fields, { context, field: 1, wire: 2 }),
    messageId: requiredString(fields, { context, field: 2, wire: 2 }),
    mode: requiredUint32(fields, { context, field: 4, wire: 0 }),
    selectedContextBlob: requiredField(fields, { context, field: 10, wire: 2 }).bytes,
    correlationId: requiredString(fields, { context, field: 17, wire: 2 }),
  }
  return {
    ...base,
    ...(selectedContext === undefined
      ? {}
      : { selectedContext: decodeSelectedContext(selectedContext.bytes) }),
    ...(isSimulatedMessage === undefined ? {} : { isSimulatedMessage }),
    ...(bestOfNGroupId === undefined ? {} : { bestOfNGroupId }),
    ...(tryUseBestOfNPromotion === undefined ? {} : { tryUseBestOfNPromotion }),
    ...(richText === undefined ? {} : { richText }),
  }
}

function encodeUserMessage(message: UserMessage): Uint8Array {
  return concatBytes([
    encodeStringField(1, message.text),
    encodeStringField(2, message.messageId),
    ...(message.selectedContext === undefined
      ? []
      : [encodeBytesField(3, encodeSelectedContext(message.selectedContext))]),
    encodeInt32Field(4, message.mode),
    ...(message.isSimulatedMessage === undefined
      ? []
      : [encodeBoolField(5, message.isSimulatedMessage)]),
    ...(message.bestOfNGroupId === undefined ? [] : [encodeStringField(6, message.bestOfNGroupId)]),
    ...(message.tryUseBestOfNPromotion === undefined
      ? []
      : [encodeBoolField(7, message.tryUseBestOfNPromotion)]),
    ...(message.richText === undefined ? [] : [encodeStringField(8, message.richText)]),
    encodeBytesField(10, message.selectedContextBlob),
    encodeStringField(17, message.correlationId),
  ])
}

export function decodeConversationAction(bytes: Uint8Array): ConversationAction {
  const context = "ConversationAction"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5, 6, 7, 8], context)
  const action = oneofField(fields, [1, 2, 3, 4, 5, 6, 7, 8], context)
  if (action.field !== 1) {
    const kinds: readonly Exclude<ConversationAction["kind"], "user-message">[] = [
      "resume",
      "cancel",
      "summarize",
      "shell-command",
      "start-plan",
      "execute-plan",
      "async-ask-question-completion",
    ]
    const kind = kinds[action.field - 2]
    if (kind === undefined) {
      throw new CursorProtocolError("malformed", context, "action variant is absent")
    }
    return { kind, payload: action.bytes }
  }
  const actionContext = "UserMessageAction"
  const actionFields = decodeFieldsStrict(action.bytes, { context: actionContext })
  assertKnownFields(actionFields, [1, 2, 3], actionContext)
  const userMessage = optionalField(actionFields, { context: actionContext, field: 1, wire: 2 })
  const requestContext = optionalField(actionFields, { context: actionContext, field: 2, wire: 2 })
  const listener = optionalBool(actionFields, { context: actionContext, field: 3, wire: 0 })
  return {
    kind: "user-message",
    ...(userMessage === undefined ? {} : { userMessage: decodeUserMessage(userMessage.bytes) }),
    ...(requestContext === undefined ? {} : { requestContextBytes: requestContext.bytes }),
    ...(listener === undefined ? {} : { sendToInteractionListener: listener }),
  }
}

export function encodeConversationAction(action: ConversationAction): Uint8Array {
  if (action.kind !== "user-message") {
    const fields: Record<Exclude<ConversationAction["kind"], "user-message">, number> = {
      resume: 2,
      cancel: 3,
      summarize: 4,
      "shell-command": 5,
      "start-plan": 6,
      "execute-plan": 7,
      "async-ask-question-completion": 8,
    }
    return encodeBytesField(fields[action.kind], action.payload)
  }
  return encodeBytesField(
    1,
    concatBytes([
      ...(action.userMessage === undefined
        ? []
        : [encodeBytesField(1, encodeUserMessage(action.userMessage))]),
      ...(action.requestContextBytes === undefined
        ? []
        : [encodeBytesField(2, action.requestContextBytes)]),
      ...(action.sendToInteractionListener === undefined
        ? []
        : [encodeBoolField(3, action.sendToInteractionListener)]),
    ]),
  )
}
