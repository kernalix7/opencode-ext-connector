// Derived from Rahularya01/pi-cursor v1.4.26 request-build.ts. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import type { CursorBlobId, CursorBlobStore } from "./blob-store.js"
import type { UserMessage } from "./proto/context.js"
import { encodeMcpArgs, encodeMcpResult } from "./proto/mcp.js"
import { concatBytes, encodeBytesField, encodeStringField } from "./proto-wire.js"
import type { CursorRequestBlobCollector } from "./request-blob-ownership.js"
import type { CursorRunMessage, CursorRunStep, CursorRunTurn } from "./request-input.js"

export type CursorRequestIds = { readonly create: () => string }
export type CursorStoredHistory = {
  readonly rootPromptBlobIds: readonly Uint8Array[]
  readonly turnBlobIds: readonly Uint8Array[]
}

function wireId(blobId: CursorBlobId): Uint8Array {
  return new Uint8Array(Buffer.from(blobId, "hex"))
}

export function storeCursorRequestBlob(
  store: CursorBlobStore,
  ownership: CursorRequestBlobCollector,
  bytes: Uint8Array,
): Uint8Array {
  const blobId = store.put(bytes)
  if (blobId === null) throw new CursorRequestBlobError()
  ownership.acquire(blobId)
  return wireId(blobId)
}

export class CursorRequestBlobError extends Error {
  public constructor() {
    super("Cursor request blob store rejected content")
    this.name = "CursorRequestBlobError"
  }
}

export function normalizeCursorRootPromptBytes(prompt: string): Uint8Array {
  const normalized = prompt.replace(/\r\n?/g, "\n").trim()
  const message = {
    role: "user",
    content: [{ type: "text", text: `<rules>\n${normalized}\n</rules>` }],
  }
  return new TextEncoder().encode(JSON.stringify(message))
}

export function buildCursorSelectedContextBlob(systemBlobId: Uint8Array): Uint8Array {
  return concatBytes([encodeBytesField(1, systemBlobId), encodeStringField(22, "opencode")])
}

export function buildCursorUserMessage(
  message: CursorRunMessage,
  context: {
    readonly selectedContextBlob: Uint8Array
    readonly store: CursorBlobStore
    readonly ownership: CursorRequestBlobCollector
    readonly ids: CursorRequestIds
  },
): UserMessage {
  const messageId = context.ids.create()
  return {
    text: message.text,
    messageId,
    selectedContext: {
      selectedImages: message.images.map((image) => ({
        uuid: context.ids.create(),
        path: "",
        mimeType: image.mimeType,
        data: {
          kind: "blob-id",
          bytes: storeCursorRequestBlob(context.store, context.ownership, image.data),
        },
      })),
      extraContext: [...(message.selectedContext ?? [])],
    },
    mode: 1,
    selectedContextBlob: context.selectedContextBlob,
    correlationId: messageId,
  }
}

function encodeStep(step: CursorRunStep): Uint8Array {
  switch (step.kind) {
    case "assistant":
      return encodeBytesField(1, encodeStringField(1, step.text))
    case "thinking":
      return encodeBytesField(3, encodeStringField(1, step.text))
    case "tool": {
      const args = encodeBytesField(
        1,
        encodeMcpArgs({
          name: step.toolName,
          args: step.arguments,
          toolCallId: step.toolCallId,
          providerIdentifier: "opencode",
          toolName: step.toolName,
        }),
      )
      const result =
        step.result === undefined
          ? []
          : [
              encodeBytesField(
                2,
                encodeMcpResult(
                  step.result.kind === "success" ? { ...step.result, isError: false } : step.result,
                ),
              ),
            ]
      return encodeBytesField(2, encodeBytesField(15, concatBytes([args, ...result])))
    }
  }
}

function rootMessages(turn: CursorRunTurn): readonly object[] {
  const messages: object[] = [{ role: "user", content: [{ type: "text", text: turn.user.text }] }]
  for (const step of turn.steps) {
    switch (step.kind) {
      case "assistant":
        messages.push({ role: "assistant", content: [{ type: "text", text: step.text }] })
        break
      case "thinking":
        break
      case "tool":
        messages.push({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: step.toolCallId,
              toolName: `mcp_opencode_${step.toolName}`,
              args: step.arguments,
            },
          ],
        })
        if (step.result !== undefined)
          messages.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: step.toolCallId,
                toolName: `mcp_opencode_${step.toolName}`,
                result: step.result,
              },
            ],
          })
        break
    }
  }
  return messages
}

export function storeCursorHistory(input: {
  readonly turns: readonly CursorRunTurn[]
  readonly systemPrompt: string
  readonly store: CursorBlobStore
  readonly ownership: CursorRequestBlobCollector
  readonly ids: CursorRequestIds
}): CursorStoredHistory & { readonly selectedContextBlob: Uint8Array } {
  const systemBytes = new TextEncoder().encode(
    JSON.stringify({ role: "system", content: input.systemPrompt }),
  )
  const systemBlobId = storeCursorRequestBlob(input.store, input.ownership, systemBytes)
  const selectedContextBlob = storeCursorRequestBlob(
    input.store,
    input.ownership,
    buildCursorSelectedContextBlob(systemBlobId),
  )
  const rootPromptBlobIds = [
    systemBlobId,
    storeCursorRequestBlob(
      input.store,
      input.ownership,
      normalizeCursorRootPromptBytes(input.systemPrompt),
    ),
  ]
  const turnBlobIds = input.turns.map((turn) => {
    const userMessage = buildCursorUserMessage(turn.user, {
      selectedContextBlob,
      store: input.store,
      ownership: input.ownership,
      ids: input.ids,
    })
    const userBlob = storeCursorRequestBlob(
      input.store,
      input.ownership,
      encodeCursorUserMessage(userMessage),
    )
    const steps = turn.steps.map((step) =>
      storeCursorRequestBlob(input.store, input.ownership, encodeStep(step)),
    )
    for (const message of rootMessages(turn))
      rootPromptBlobIds.push(
        storeCursorRequestBlob(
          input.store,
          input.ownership,
          new TextEncoder().encode(JSON.stringify(message)),
        ),
      )
    return storeCursorRequestBlob(
      input.store,
      input.ownership,
      encodeBytesField(
        1,
        concatBytes([
          encodeBytesField(1, userBlob),
          ...steps.map((value) => encodeBytesField(2, value)),
          encodeStringField(3, input.ids.create()),
        ]),
      ),
    )
  })
  return { rootPromptBlobIds, turnBlobIds, selectedContextBlob }
}

function encodeCursorUserMessage(message: UserMessage): Uint8Array {
  const selected = message.selectedContext
  return concatBytes([
    encodeStringField(1, message.text),
    encodeStringField(2, message.messageId),
    ...(selected === undefined
      ? []
      : [
          encodeBytesField(
            3,
            concatBytes([
              ...selected.selectedImages.map((image) =>
                encodeBytesField(
                  1,
                  concatBytes([
                    encodeBytesField(
                      1,
                      image.data.kind === "blob-id" ? image.data.bytes : new Uint8Array(),
                    ),
                    encodeStringField(2, image.uuid),
                    encodeStringField(7, image.mimeType),
                  ]),
                ),
              ),
              ...selected.extraContext.map((value) => encodeStringField(3, value)),
            ]),
          ),
        ]),
    new Uint8Array([0x20, 0x01]),
    encodeBytesField(10, message.selectedContextBlob),
    encodeStringField(17, message.correlationId),
  ])
}
