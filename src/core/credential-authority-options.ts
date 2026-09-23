import { z } from "zod"

export type ClaudeCliCredentialAuthority = {
  readonly enabled: boolean
  readonly leadMs: number
  readonly retryMs: number
}

export type CredentialAuthority = {
  readonly claudeCli: ClaudeCliCredentialAuthority
}

export type CredentialAuthorityInput = {
  readonly claudeCli?:
    | {
        readonly enabled: boolean
        readonly leadMs?: number | undefined
        readonly retryMs?: number | undefined
      }
    | undefined
}

const SafeIntegerSchema = z.number().int().safe()

export const CredentialAuthorityInputSchema: z.ZodType<
  CredentialAuthorityInput,
  CredentialAuthorityInput
> = z
  .object({
    claudeCli: z
      .object({
        enabled: z.boolean(),
        leadMs: SafeIntegerSchema.nonnegative().optional(),
        retryMs: SafeIntegerSchema.positive().optional(),
      })
      .strict()
      .readonly()
      .optional(),
  })
  .strict()
  .readonly()

export function resolveCredentialAuthority(
  input: CredentialAuthorityInput | undefined,
  claudeOwner: boolean,
): CredentialAuthority {
  return Object.freeze({
    claudeCli: Object.freeze({
      enabled: claudeOwner || (input?.claudeCli?.enabled ?? false),
      leadMs: input?.claudeCli?.leadMs ?? 300_000,
      retryMs: input?.claudeCli?.retryMs ?? 300_000,
    }),
  })
}
