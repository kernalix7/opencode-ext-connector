import { z } from "zod"

import type { ModelId, ProviderId } from "./ids"
import { ModelIdSchema, ProviderIdSchema } from "./ids"

export type AdapterModelInput = { readonly id: string }
export type AdapterModel = { readonly id: ModelId }
export type ProviderFailureReason =
  | "adapter-error"
  | "transport-error"
  | "process-error"
  | "invalid-data"

export type ProviderSnapshotInput =
  | {
      readonly status: "ready"
      readonly providerId: string
      readonly models: readonly AdapterModelInput[]
    }
  | {
      readonly status: "stale"
      readonly providerId: string
      readonly models: readonly AdapterModelInput[]
      readonly reason: ProviderFailureReason
    }
  | {
      readonly status: "unavailable"
      readonly providerId: string
      readonly reason: ProviderFailureReason
    }

export type ProviderSnapshot =
  | {
      readonly status: "ready"
      readonly providerId: ProviderId
      readonly models: readonly AdapterModel[]
    }
  | {
      readonly status: "stale"
      readonly providerId: ProviderId
      readonly models: readonly AdapterModel[]
      readonly reason: ProviderFailureReason
    }
  | {
      readonly status: "unavailable"
      readonly providerId: ProviderId
      readonly reason: ProviderFailureReason
    }

export const AdapterModelSchema: z.ZodType<AdapterModel, AdapterModelInput> = z
  .object({ id: ModelIdSchema })
  .strict()
  .readonly()

const ProviderFailureReasonSchema = z.union([
  z.literal("adapter-error"),
  z.literal("transport-error"),
  z.literal("process-error"),
  z.literal("invalid-data"),
])

const AdapterModelsSchema = z
  .array(AdapterModelSchema)
  .superRefine((models, context) => {
    const ids = new Set<ModelId>()
    for (const model of models) {
      if (ids.has(model.id)) {
        context.addIssue({ code: "custom", message: "duplicate model ID" })
      }
      ids.add(model.id)
    }
  })
  .readonly()

export const ProviderSnapshotSchema: z.ZodType<ProviderSnapshot, ProviderSnapshotInput> = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("ready"),
        providerId: ProviderIdSchema,
        models: AdapterModelsSchema,
      })
      .strict()
      .readonly(),
    z
      .object({
        status: z.literal("stale"),
        providerId: ProviderIdSchema,
        models: AdapterModelsSchema,
        reason: ProviderFailureReasonSchema,
      })
      .strict()
      .readonly(),
    z
      .object({
        status: z.literal("unavailable"),
        providerId: ProviderIdSchema,
        reason: ProviderFailureReasonSchema,
      })
      .strict()
      .readonly(),
  ])
  .readonly()

export function parseAdapterModel(input: unknown): AdapterModel {
  return AdapterModelSchema.parse(input)
}

export function parseProviderSnapshot(input: unknown): ProviderSnapshot {
  return ProviderSnapshotSchema.parse(input)
}
