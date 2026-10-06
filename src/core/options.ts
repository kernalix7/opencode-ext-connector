import { z } from "zod"

import type { HealthPolicy } from "./health.js"

export type ConnectorOptionsInput = {
  readonly providers?: readonly ("claude" | "command-code" | "ollama")[] | undefined
  readonly snapshotTimeoutMs?: number | undefined
  readonly catalogReloadMs?: number | undefined
  readonly health?:
    | {
        readonly initialBackoffMs?: number | undefined
        readonly maximumBackoffMs?: number | undefined
      }
    | undefined
}

export type ConnectorOptions = {
  readonly providers: readonly ("claude" | "command-code" | "ollama")[]
  readonly snapshotTimeoutMs: number
  readonly catalogReloadMs: number
  readonly health: HealthPolicy
}

const MaximumTimerMs = 2_147_483_647
const PositiveTimer = z.number().int().positive().max(MaximumTimerMs)
const NonNegativeTimer = z.number().int().nonnegative().max(MaximumTimerMs)
const providers = ["claude", "command-code", "ollama"] as const
const retired = [
  "credentialRole",
  "credentialManagement",
  "credentialAuthority",
  "credentialRefresh",
  "writeBackCredentials",
  "xaiOAuth",
] as const

const InputSchema = z
  .object({
    providers: z.array(z.enum(providers)).optional(),
    snapshotTimeoutMs: PositiveTimer.optional(),
    catalogReloadMs: NonNegativeTimer.optional(),
    health: z
      .object({
        initialBackoffMs: PositiveTimer.optional(),
        maximumBackoffMs: PositiveTimer.optional(),
      })
      .strict()
      .optional(),
    credentialRole: z.unknown().optional(),
    credentialManagement: z.unknown().optional(),
    credentialAuthority: z.unknown().optional(),
    credentialRefresh: z.unknown().optional(),
    writeBackCredentials: z.unknown().optional(),
    xaiOAuth: z.unknown().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    for (const field of retired) {
      if (Object.hasOwn(input, field)) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} was retired; use a dedicated API-key connection instead`,
        })
      }
    }
    if ((input.health?.initialBackoffMs ?? 1_000) > (input.health?.maximumBackoffMs ?? 60_000)) {
      context.addIssue({ code: "custom", message: "initial backoff exceeds maximum" })
    }
  })

export const ConnectorOptionsSchema: z.ZodType<ConnectorOptions> = InputSchema.transform((input) =>
  Object.freeze({
    providers: Object.freeze(input.providers ?? [...providers]),
    snapshotTimeoutMs: input.snapshotTimeoutMs ?? 30_000,
    catalogReloadMs: input.catalogReloadMs ?? 300_000,
    health: Object.freeze({
      initialBackoffMs: input.health?.initialBackoffMs ?? 1_000,
      maximumBackoffMs: input.health?.maximumBackoffMs ?? 60_000,
    }),
  }),
)

export function parseConnectorOptions(input: unknown): ConnectorOptions {
  return ConnectorOptionsSchema.parse(input)
}
