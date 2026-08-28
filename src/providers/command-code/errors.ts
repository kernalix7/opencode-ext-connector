import { z } from "zod"

export const COMMAND_CODE_PROVIDER_ERROR = "COMMAND_CODE_PROVIDER_ERROR"

export const commandCodeProviderErrorStages = [
  "http-response",
  "ndjson-stream",
  "response-body",
] as const

export type CommandCodeProviderErrorStage = (typeof commandCodeProviderErrorStages)[number]

type CommandCodeProviderErrorOptions = {
  readonly stage: CommandCodeProviderErrorStage
  readonly statusCode: number | null
  readonly providerCode: string | null
  readonly retryable: boolean
}

export type CommandCodeProviderMetadata = {
  readonly code?: string
  readonly statusCode?: number
  readonly isRetryable?: boolean
}

const commandCodeProviderMetadataSchema = z
  .object({
    code: z.string().optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    isRetryable: z.boolean().optional(),
  })
  .passthrough()

const httpErrorBodySchema = z.union([
  z.object({ error: commandCodeProviderMetadataSchema }).transform((value) => value.error),
  commandCodeProviderMetadataSchema,
])

export class CommandCodeProviderError extends Error {
  public override readonly name = "CommandCodeProviderError"
  public readonly code: typeof COMMAND_CODE_PROVIDER_ERROR = COMMAND_CODE_PROVIDER_ERROR
  public readonly stage: CommandCodeProviderErrorStage
  public readonly statusCode: number | null
  public readonly providerCode: string | null
  public readonly retryable: boolean

  public constructor(options: CommandCodeProviderErrorOptions) {
    super("Command Code provider request failed")
    this.stage = options.stage
    this.statusCode = options.statusCode
    this.providerCode = options.providerCode
    this.retryable = options.retryable
  }
}

function parseHttpMetadata(body: string): CommandCodeProviderMetadata | null {
  try {
    const parsed: unknown = JSON.parse(body)
    const result = httpErrorBodySchema.safeParse(parsed)
    if (!result.success) return null
    return {
      ...(result.data.code === undefined ? {} : { code: result.data.code }),
      ...(result.data.statusCode === undefined ? {} : { statusCode: result.data.statusCode }),
      ...(result.data.isRetryable === undefined ? {} : { isRetryable: result.data.isRetryable }),
    }
  } catch {
    return null
  }
}

export function commandCodeHttpError(statusCode: number, body: string): CommandCodeProviderError {
  const metadata = parseHttpMetadata(body)
  return new CommandCodeProviderError({
    stage: "http-response",
    statusCode,
    providerCode: metadata?.code ?? null,
    retryable: metadata?.isRetryable ?? (statusCode === 429 || statusCode >= 500),
  })
}

export function commandCodeNdjsonError(
  error: string | CommandCodeProviderMetadata | undefined,
): CommandCodeProviderError {
  const metadata = typeof error === "object" ? error : undefined
  return new CommandCodeProviderError({
    stage: "ndjson-stream",
    statusCode: metadata?.statusCode ?? null,
    providerCode: metadata?.code ?? null,
    retryable: metadata?.isRetryable ?? false,
  })
}

export function commandCodeMissingBodyError(statusCode: number): CommandCodeProviderError {
  return new CommandCodeProviderError({
    stage: "response-body",
    statusCode,
    providerCode: null,
    retryable: false,
  })
}
