import { z } from "zod"

export const COMMAND_CODE_PROVIDER_ERROR = "COMMAND_CODE_PROVIDER_ERROR"
export type CommandCodeProviderErrorStage = "http-response" | "ndjson-stream" | "response-body"
export type CommandCodeProviderErrorReason =
  | "http-status"
  | "ndjson-event"
  | "missing-response-body"
  | "response-body-too-large"
  | "stream-record-too-large"
export type CommandCodeProviderMetadata = {
  readonly code?: string | undefined
  readonly statusCode?: number | undefined
  readonly isRetryable?: boolean | undefined
}
type ErrorOptions = {
  readonly stage: CommandCodeProviderErrorStage
  readonly reason: CommandCodeProviderErrorReason
  readonly statusCode: number | null
  readonly providerCode: string | null
  readonly retryable: boolean
}
const metadataSchema = z
  .object({
    code: z.string().optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    isRetryable: z.boolean().optional(),
  })
  .passthrough()
const bodySchema = z.union([
  z.object({ error: metadataSchema }).transform((value) => value.error),
  metadataSchema,
])

export class CommandCodeProviderError extends Error {
  public override readonly name = "CommandCodeProviderError"
  public readonly code: typeof COMMAND_CODE_PROVIDER_ERROR = COMMAND_CODE_PROVIDER_ERROR
  public readonly stage: CommandCodeProviderErrorStage
  public readonly reason: CommandCodeProviderErrorReason
  public readonly statusCode: number | null
  public readonly providerCode: string | null
  public readonly retryable: boolean
  public constructor(options: ErrorOptions) {
    super("Command Code provider request failed")
    this.stage = options.stage
    this.reason = options.reason
    this.statusCode = options.statusCode
    this.providerCode = options.providerCode
    this.retryable = options.retryable
  }
}

export function commandCodeHttpError(statusCode: number, body: string): CommandCodeProviderError {
  let metadata: CommandCodeProviderMetadata | null = null
  try {
    const decoded: unknown = JSON.parse(body)
    const result = bodySchema.safeParse(decoded)
    if (result.success) metadata = result.data
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  return new CommandCodeProviderError({
    stage: "http-response",
    reason: "http-status",
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
    reason: "ndjson-event",
    statusCode: metadata?.statusCode ?? null,
    providerCode: metadata?.code ?? null,
    retryable: metadata?.isRetryable ?? false,
  })
}
export function commandCodeMissingBodyError(statusCode: number): CommandCodeProviderError {
  return new CommandCodeProviderError({
    stage: "response-body",
    reason: "missing-response-body",
    statusCode,
    providerCode: null,
    retryable: false,
  })
}
export function commandCodeResponseBodyTooLargeError(): CommandCodeProviderError {
  return new CommandCodeProviderError({
    stage: "response-body",
    reason: "response-body-too-large",
    statusCode: null,
    providerCode: null,
    retryable: false,
  })
}
export function commandCodeStreamRecordTooLargeError(): CommandCodeProviderError {
  return new CommandCodeProviderError({
    stage: "ndjson-stream",
    reason: "stream-record-too-large",
    statusCode: null,
    providerCode: null,
    retryable: false,
  })
}
