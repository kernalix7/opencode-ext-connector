import { z } from "zod"

import type { HealthPolicy } from "./health"

export type CredentialRefreshMode = "auto" | "never"

export type CredentialRefreshPolicy = {
  readonly mode: CredentialRefreshMode
  readonly leadMs: number
}

export type ConnectorOptionsInput = {
  readonly providers?: readonly ("claude" | "cursor" | "command-code" | "ollama")[] | undefined
  readonly snapshotTimeoutMs?: number | undefined
  readonly writeBackCredentials?: boolean | undefined
  readonly credentialRefresh?:
    | {
        readonly mode?: CredentialRefreshMode | undefined
        readonly leadMs?: number | undefined
      }
    | undefined
  readonly catalogReloadMs?: number | undefined
  readonly health?:
    | {
        readonly initialBackoffMs?: number | undefined
        readonly maximumBackoffMs?: number | undefined
      }
    | undefined
}

export type ConnectorOptions = {
  readonly providers: readonly ("claude" | "cursor" | "command-code" | "ollama")[]
  readonly snapshotTimeoutMs: number
  readonly writeBackCredentials: boolean
  readonly credentialRefresh: CredentialRefreshPolicy
  readonly catalogReloadMs: number
  readonly health: HealthPolicy
}

const MaximumTimerMs = 2_147_483_647
const PositiveSafeIntegerSchema = z.number().int().positive().max(MaximumTimerMs)
const NonNegativeSafeIntegerSchema = z.number().int().nonnegative().max(MaximumTimerMs)
const ProviderSchema = z.enum(["claude", "cursor", "command-code", "ollama"])
const CredentialRefreshModeSchema = z.enum(["auto", "never"])
const DefaultProviders: ConnectorOptions["providers"] = [
  "claude",
  "cursor",
  "command-code",
  "ollama",
]

const ConnectorOptionsInputSchema = z
  .object({
    providers: z.array(ProviderSchema).optional(),
    snapshotTimeoutMs: PositiveSafeIntegerSchema.optional(),
    writeBackCredentials: z.boolean().optional(),
    credentialRefresh: z
      .object({
        mode: CredentialRefreshModeSchema.optional(),
        leadMs: NonNegativeSafeIntegerSchema.optional(),
      })
      .strict()
      .optional(),
    catalogReloadMs: NonNegativeSafeIntegerSchema.optional(),
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
    const credentialRefresh = Object.freeze({
      mode: input.credentialRefresh?.mode ?? "auto",
      leadMs: input.credentialRefresh?.leadMs ?? 60_000,
    })
    return Object.freeze({
      providers: Object.freeze(input.providers ?? DefaultProviders),
      snapshotTimeoutMs: input.snapshotTimeoutMs ?? 30_000,
      writeBackCredentials: input.writeBackCredentials ?? false,
      credentialRefresh,
      catalogReloadMs: input.catalogReloadMs ?? 300_000,
      health,
    })
  })

export function parseConnectorOptions(input: unknown): ConnectorOptions {
  return ConnectorOptionsSchema.parse(input)
}
