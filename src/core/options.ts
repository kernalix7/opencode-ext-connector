import { z } from "zod"

import type { HealthPolicy } from "./health.js"

export type CredentialRefreshMode = "auto" | "never"
export type CredentialManagement = "connector" | "external"

export type CredentialRefreshPolicy = {
  readonly mode: CredentialRefreshMode
  readonly leadMs: number
}

export type ConnectorOptionsInput = {
  readonly providers?: readonly ("claude" | "cursor" | "command-code" | "ollama")[] | undefined
  readonly snapshotTimeoutMs?: number | undefined
  readonly credentialManagement?: CredentialManagement | undefined
  /** @deprecated Use credentialManagement instead. */
  readonly writeBackCredentials?: boolean | undefined
  /** @deprecated Use credentialManagement instead. */
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
const CredentialManagementSchema = z.enum(["connector", "external"])
const DefaultProviders: ConnectorOptions["providers"] = [
  "claude",
  "cursor",
  "command-code",
  "ollama",
]

type ResolvedCredentialOptions = {
  readonly credentialRefresh: CredentialRefreshPolicy
  readonly writeBackCredentials: boolean
}

function resolveCredentialOptions(input: ConnectorOptionsInput): ResolvedCredentialOptions {
  switch (input.credentialManagement) {
    case undefined:
      return {
        credentialRefresh: Object.freeze({
          mode: input.credentialRefresh?.mode ?? "auto",
          leadMs: input.credentialRefresh?.leadMs ?? 60_000,
        }),
        writeBackCredentials: input.writeBackCredentials ?? false,
      }
    case "connector":
      return {
        credentialRefresh: Object.freeze({ mode: "auto", leadMs: 60_000 }),
        writeBackCredentials: true,
      }
    case "external":
      return {
        credentialRefresh: Object.freeze({ mode: "never", leadMs: 60_000 }),
        writeBackCredentials: false,
      }
  }
}

const ConnectorOptionsInputSchema = z
  .object({
    providers: z.array(ProviderSchema).optional(),
    snapshotTimeoutMs: PositiveSafeIntegerSchema.optional(),
    credentialManagement: CredentialManagementSchema.optional(),
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
    if (
      input.credentialManagement !== undefined &&
      (input.credentialRefresh !== undefined || input.writeBackCredentials !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialManagement"],
        message:
          "`credentialManagement` cannot be combined with deprecated `credentialRefresh` or `writeBackCredentials`",
      })
    }
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
    const credentialOptions = resolveCredentialOptions(input)
    return Object.freeze({
      providers: Object.freeze(input.providers ?? DefaultProviders),
      snapshotTimeoutMs: input.snapshotTimeoutMs ?? 30_000,
      writeBackCredentials: credentialOptions.writeBackCredentials,
      credentialRefresh: credentialOptions.credentialRefresh,
      catalogReloadMs: input.catalogReloadMs ?? 300_000,
      health,
    })
  })

export function parseConnectorOptions(input: unknown): ConnectorOptions {
  return ConnectorOptionsSchema.parse(input)
}
