import { z } from "zod"

import type { HealthPolicy } from "./health.js"

export type CredentialRefreshMode = "auto" | "never"
export type CredentialManagement = "connector" | "external"
export type CredentialRole = "owner" | "reader"

export type CredentialRefreshPolicy = {
  readonly mode: CredentialRefreshMode
  readonly leadMs: number
}

export type ClaudeCliCredentialAuthority = {
  readonly enabled: boolean
  readonly leadMs: number
  readonly retryMs: number
}

export type CredentialAuthority = {
  readonly claudeCli: ClaudeCliCredentialAuthority
}

export type ConnectorOptionsInput = {
  readonly providers?: readonly ("claude" | "cursor" | "command-code" | "ollama")[] | undefined
  readonly snapshotTimeoutMs?: number | undefined
  readonly credentialRole?: CredentialRole | undefined
  readonly credentialManagement?: CredentialManagement | undefined
  readonly credentialAuthority?:
    | {
        readonly claudeCli: {
          readonly enabled: boolean
          readonly leadMs?: number | undefined
          readonly retryMs?: number | undefined
        }
      }
    | undefined
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
  readonly credentialAuthority: CredentialAuthority
  readonly catalogReloadMs: number
  readonly health: HealthPolicy
}

const MaximumTimerMs = 2_147_483_647
const PositiveSafeIntegerSchema = z.number().int().positive().max(MaximumTimerMs)
const NonNegativeSafeIntegerSchema = z.number().int().nonnegative().max(MaximumTimerMs)
const ProviderSchema = z.enum(["claude", "cursor", "command-code", "ollama"])
const CredentialRefreshModeSchema = z.enum(["auto", "never"])
const CredentialManagementSchema = z.enum(["connector", "external"])
const CredentialRoleSchema = z.enum(["owner", "reader"])
const SafeIntegerSchema = z.number().int().safe()
const DefaultProviders: ConnectorOptions["providers"] = [
  "claude",
  "cursor",
  "command-code",
  "ollama",
]
const CredentialAuthorityInputSchema = z
  .object({
    claudeCli: z
      .object({
        enabled: z.boolean(),
        leadMs: SafeIntegerSchema.nonnegative().optional(),
        retryMs: SafeIntegerSchema.positive().optional(),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly()

type ResolvedCredentialOptions = {
  readonly credentialRefresh: CredentialRefreshPolicy
  readonly writeBackCredentials: boolean
}

function resolveCredentialOptions(input: ConnectorOptionsInput): ResolvedCredentialOptions {
  const credentialManagement =
    input.credentialRole === undefined ? input.credentialManagement : "external"
  switch (credentialManagement) {
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
    credentialRole: CredentialRoleSchema.optional(),
    credentialManagement: CredentialManagementSchema.optional(),
    credentialAuthority: CredentialAuthorityInputSchema.optional(),
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
      input.credentialRole !== undefined &&
      (input.credentialManagement !== undefined ||
        input.credentialAuthority !== undefined ||
        input.credentialRefresh !== undefined ||
        input.writeBackCredentials !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialRole"],
        message:
          "`credentialRole` cannot be combined with `credentialManagement`, `credentialAuthority`, `credentialRefresh`, or `writeBackCredentials`",
      })
    }
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
    if (
      input.credentialAuthority?.claudeCli.enabled === true &&
      (input.credentialManagement !== "external" ||
        !(input.providers ?? DefaultProviders).includes("claude"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialAuthority", "claudeCli", "enabled"],
        message:
          "Claude CLI credential authority requires external credential management and the Claude provider",
      })
    }
    if (
      input.credentialRole === "owner" &&
      !(input.providers ?? DefaultProviders).includes("claude")
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialRole"],
        message: "Credential owner role requires the Claude provider",
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
    const credentialAuthority = Object.freeze({
      claudeCli: Object.freeze({
        enabled:
          input.credentialRole === "owner"
            ? true
            : (input.credentialAuthority?.claudeCli.enabled ?? false),
        leadMs: input.credentialAuthority?.claudeCli.leadMs ?? 300_000,
        retryMs: input.credentialAuthority?.claudeCli.retryMs ?? 300_000,
      }),
    })
    return Object.freeze({
      providers: Object.freeze(input.providers ?? DefaultProviders),
      snapshotTimeoutMs: input.snapshotTimeoutMs ?? 30_000,
      writeBackCredentials: credentialOptions.writeBackCredentials,
      credentialRefresh: credentialOptions.credentialRefresh,
      credentialAuthority,
      catalogReloadMs: input.catalogReloadMs ?? 300_000,
      health,
    })
  })

export function parseConnectorOptions(input: unknown): ConnectorOptions {
  return ConnectorOptionsSchema.parse(input)
}
