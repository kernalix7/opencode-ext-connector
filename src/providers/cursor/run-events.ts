// Derived from Rahularya01/pi-cursor AgentServerMessage interaction updates.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { InteractionUpdate } from "./proto/interaction"
import { decodeAgentServerMessage } from "./proto/server"

export type CursorRunEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "turn-ended" }
  | {
      readonly kind: "tool"
      readonly callId: string
      readonly name: string
      readonly args: unknown
    }

function eventFromUpdate(update: InteractionUpdate): CursorRunEvent | null {
  switch (update.kind) {
    case "text-delta":
      return update.text === "" ? null : { kind: "text", text: update.text }
    case "thinking-delta":
      return update.text === "" ? null : { kind: "thinking", text: update.text }
    case "turn-ended":
      return { kind: "turn-ended" }
    case "tool-call-started": {
      const name = update.args.toolName || update.args.name
      return update.callId === "" || name === ""
        ? null
        : { kind: "tool", callId: update.callId, name, args: update.args.args }
    }
    case "tool-call-completed":
    case "thinking-completed":
    case "user-message-appended":
    case "partial-tool-call":
    case "token-delta":
    case "summary":
    case "summary-started":
    case "summary-completed":
    case "shell-output-delta":
    case "heartbeat":
    case "tool-call-delta":
    case "step-started":
    case "step-completed":
    case "field-25":
      return null
    default:
      return update satisfies never
  }
}

export function extractCursorRunEvents(bytes: Uint8Array): readonly CursorRunEvent[] {
  const message = decodeAgentServerMessage(bytes)
  if (message.kind !== "interaction-update") return []
  const event = eventFromUpdate(message.update)
  return event === null ? [] : [event]
}
