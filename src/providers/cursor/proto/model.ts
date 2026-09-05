// Derived from Rahularya01/pi-cursor proto/agent.proto RequestedModel. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import {
  concatBytes,
  decodeFieldsStrict,
  encodeBoolField,
  encodeBytesField,
  encodeStringField,
} from "../proto-wire.js"
import { assertKnownFields, optionalBool, optionalString, repeatedFields } from "./fields.js"

export type RequestedModelParameter = {
  readonly id: string
  readonly value: string
}

export type RequestedModel = {
  readonly modelId: string
  readonly maxMode: boolean
  readonly parameters: readonly RequestedModelParameter[]
}

function decodeParameter(bytes: Uint8Array): RequestedModelParameter {
  const context = "RequestedModel.Parameter"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2], context)
  return {
    id: optionalString(fields, { context, field: 1, wire: 2 }) ?? "",
    value: optionalString(fields, { context, field: 2, wire: 2 }) ?? "",
  }
}

function encodeParameter(parameter: RequestedModelParameter): Uint8Array {
  return concatBytes([
    ...(parameter.id === "" ? [] : [encodeStringField(1, parameter.id)]),
    ...(parameter.value === "" ? [] : [encodeStringField(2, parameter.value)]),
  ])
}

export function decodeRequestedModel(bytes: Uint8Array): RequestedModel {
  const context = "RequestedModel"
  const fields = decodeFieldsStrict(bytes, { context })
  assertKnownFields(fields, [1, 2, 3], context)
  return {
    modelId: optionalString(fields, { context, field: 1, wire: 2 }) ?? "",
    maxMode: optionalBool(fields, { context, field: 2, wire: 0 }) ?? false,
    parameters: repeatedFields(fields, { context, field: 3, wire: 2 }).map((entry) =>
      decodeParameter(entry.bytes),
    ),
  }
}

export function encodeRequestedModel(model: RequestedModel): Uint8Array {
  return concatBytes([
    ...(model.modelId === "" ? [] : [encodeStringField(1, model.modelId)]),
    ...(model.maxMode ? [encodeBoolField(2, true)] : []),
    ...model.parameters.map((parameter) => encodeBytesField(3, encodeParameter(parameter))),
  ])
}
