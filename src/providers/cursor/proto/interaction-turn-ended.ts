// Derived from Rahularya01/pi-cursor proto/agent.proto TurnEndedUpdate. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { decodeFieldsStrict } from "../proto-wire.js"
import { assertKnownFields, optionalField } from "./fields.js"

export type TurnEndedUpdate = {
  readonly kind: "turn-ended"
  readonly payload?: Uint8Array
}

export function decodeTurnEndedUpdate(bytes: Uint8Array): TurnEndedUpdate {
  const context = "TurnEndedUpdate"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3, 4, 5], context)
  optionalField(fields, { context, field: 1, wire: 0 })
  optionalField(fields, { context, field: 2, wire: 0 })
  optionalField(fields, { context, field: 3, wire: 0 })
  optionalField(fields, { context, field: 4, wire: 0 })
  optionalField(fields, { context, field: 5, wire: 0 })
  return { kind: "turn-ended", payload: bytes }
}

export function encodeTurnEndedUpdate(update: TurnEndedUpdate): Uint8Array {
  return update.payload ?? new Uint8Array()
}
