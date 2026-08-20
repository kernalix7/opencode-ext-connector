import { z } from "zod"

import type { HealthPolicy } from "./health"

export type ConnectorOptionsInput = {
  readonly snapshotTimeoutMs?: number | undefined
  readonly writeBackCredentials?: boolean | undefined
  readonly catalogReloadMs?: number | undefined
  readonly health?:
    | {
        readonly initialBackoffMs?: number | undefined
        readonly maximumBackoffMs?: number | undefined
      }
    | undefined
}

export type ConnectorOptions = {
  readonly snapshotTimeoutMs: number
  readonly writeBackCredentials: boolean
  readonly catalogReloadMs: number
  readonly health: HealthPolicy
}

const PositiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const ConnectorOptionsInputSchema = z
  .object({
    snapshotTimeoutMs: PositiveSafeIntegerSchema.optional(),
    writeBackCredentials: z.boolean().optional(),
    catalogReloadMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    health: z
      .object({
        initialBackoffMs: PositiveSafeIntegerSchema.optional(),
        maximumBackoffMs: PositiveSafeIntegerSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const initialBackoffMs = input.health?.initialBackoffMs ?? 1_000
    const maximumBackoffMs = input.health?.maximumBackoffMs ?? 60_000
    if (initialBackoffMs > maximumBackoffMs) {
      context.addIssue({ code: "custom", message: "initial backoff exceeds maximum" })
    }
  })

export const ConnectorOptionsSchema: z.ZodType<ConnectorOptions, ConnectorOptionsInput> =
  ConnectorOptionsInputSchema.transform((input) => {
    const health = Object.freeze({
      initialBackoffMs: input.health?.initialBackoffMs ?? 1_000,
      maximumBackoffMs: input.health?.maximumBackoffMs ?? 60_000,
    })
    return Object.freeze({
      snapshotTimeoutMs: input.snapshotTimeoutMs ?? 30_000,
      writeBackCredentials: input.writeBackCredentials ?? false,
      catalogReloadMs: input.catalogReloadMs ?? 300_000,
      health,
    })
  })

export function parseConnectorOptions(input: unknown): ConnectorOptions {
  return ConnectorOptionsSchema.parse(input)
}
