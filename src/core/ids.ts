import { z } from "zod"

export const ProviderIdSchema: z.core.$ZodBranded<z.ZodString, "ProviderId"> = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand<"ProviderId">()
export type ProviderId = z.output<typeof ProviderIdSchema>

export const ModelIdSchema: z.core.$ZodBranded<z.ZodString, "ModelId"> = z
  .string()
  .min(1)
  .max(256)
  .refine((value) =>
    [...value].every((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127
    }),
  )
  .refine((value) => value.trim() === value)
  .brand<"ModelId">()
export type ModelId = z.output<typeof ModelIdSchema>

export function parseProviderId(input: unknown): ProviderId {
  return ProviderIdSchema.parse(input)
}

export function parseModelId(input: unknown): ModelId {
  return ModelIdSchema.parse(input)
}
