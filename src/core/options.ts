import { z } from "zod"

import {
  type CredentialAuthority,
  type CredentialAuthorityInput,
  CredentialAuthorityInputSchema,
  resolveCredentialAuthority,
} from "./credential-authority-options.js"
import type { HealthPolicy } from "./health.js"

export type {
  ClaudeCliCredentialAuthority,
  CredentialAuthority,
} from "./credential-authority-options.js"

export type CredentialRefreshMode = "auto" | "never"
export type CredentialManagement = "connector" | "external"
export type CredentialRole = "owner" | "reader"
export type XaiOAuthMode = "authority" | "consumer"

export type XaiOAuthOptions = {
  readonly mode: XaiOAuthMode
}

export type CredentialRefreshPolicy = {
  readonly mode: CredentialRefreshMode
  readonly leadMs: number
}

export type ConnectorOptionsInput = {
  readonly providers?: readonly ("claude" | "command-code" | "ollama")[] | undefined
  readonly snapshotTimeoutMs?: number | undefined
  readonly credentialRole?: CredentialRole | undefined
  readonly xaiOAuth?: XaiOAuthOptions | undefined
  readonly credentialManagement?: CredentialManagement | undefined
  readonly credentialAuthority?: CredentialAuthorityInput | undefined
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
  readonly providers: readonly ("claude" | "command-code" | "ollama")[]
  readonly snapshotTimeoutMs: number
  readonly writeBackCredentials: boolean
  readonly credentialRefresh: CredentialRefreshPolicy
  readonly credentialAuthority: CredentialAuthority
  readonly xaiOAuth: XaiOAuthOptions | null
  readonly catalogReloadMs: number
  readonly health: HealthPolicy
}

const MaximumTimerMs = 2_147_483_647
const PositiveTimer = z.number().int().positive().max(MaximumTimerMs)
const NonNegativeTimer = z.number().int().nonnegative().max(MaximumTimerMs)
const providers = ["claude", "command-code", "ollama"] as const
const XaiOAuthSchema = z
  .object({ mode: z.enum(["authority", "consumer"]) })
  .strict()
  .readonly()

function resolveCredentialOptions(input: ConnectorOptionsInput): {
  readonly credentialRefresh: CredentialRefreshPolicy
  readonly writeBackCredentials: boolean
} {
  const management = input.credentialRole === undefined ? input.credentialManagement : "external"
  switch (management) {
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
    default: {
      const unreachable: never = management
      return unreachable
    }
  }
}

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
    credentialRole: z.enum(["owner", "reader"]).optional(),
    credentialManagement: z.enum(["connector", "external"]).optional(),
    credentialAuthority: CredentialAuthorityInputSchema.optional(),
    credentialRefresh: z
      .object({
        mode: z.enum(["auto", "never"]).optional(),
        leadMs: NonNegativeTimer.optional(),
      })
      .strict()
      .optional(),
    writeBackCredentials: z.boolean().optional(),
    xaiOAuth: XaiOAuthSchema.optional(),
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
      input.credentialAuthority?.claudeCli?.enabled === true &&
      (input.credentialManagement !== "external" ||
        !(input.providers ?? providers).includes("claude"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialAuthority", "claudeCli", "enabled"],
        message:
          "Claude CLI credential authority requires external credential management and the Claude provider",
      })
    }
    if (input.credentialRole === "owner" && !(input.providers ?? providers).includes("claude")) {
      context.addIssue({
        code: "custom",
        path: ["credentialRole"],
        message: "Credential owner role requires the Claude provider",
      })
    }
    if ((input.health?.initialBackoffMs ?? 1_000) > (input.health?.maximumBackoffMs ?? 60_000)) {
      context.addIssue({ code: "custom", message: "initial backoff exceeds maximum" })
    }
  })

export const ConnectorOptionsSchema: z.ZodType<ConnectorOptions, ConnectorOptionsInput> =
  InputSchema.transform((input) =>
    Object.freeze({
      providers: Object.freeze(input.providers ?? [...providers]),
      snapshotTimeoutMs: input.snapshotTimeoutMs ?? 30_000,
      xaiOAuth: input.xaiOAuth ?? null,
      ...resolveCredentialOptions(input),
      credentialAuthority: resolveCredentialAuthority(
        input.credentialAuthority,
        input.credentialRole === "owner",
      ),
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
