import type { ProviderId } from "./ids.js"

export type ConnectorErrorCode =
  | "invalid-argument"
  | "operation-cancelled"
  | "deadline-exceeded"
  | "resource-disposed"
  | "adapter-error"
  | "http-transport-error"
  | "process-supervisor-error"

type ConnectorErrorOptions = {
  readonly code: ConnectorErrorCode
  readonly retryable: boolean
  readonly cause: unknown | null
}

export abstract class ConnectorError extends Error {
  public readonly code: ConnectorErrorCode
  public readonly retryable: boolean
  public override readonly cause: unknown | null

  protected constructor(message: string, options: ConnectorErrorOptions) {
    super(message, { cause: options.cause })
    this.code = options.code
    this.retryable = options.retryable
    this.cause = options.cause
  }
}

export class InvalidArgumentError extends ConnectorError {
  public override readonly name = "InvalidArgumentError"
  public constructor(
    public readonly argument: string,
    cause: unknown | null = null,
  ) {
    super("invalid connector argument", { code: "invalid-argument", retryable: false, cause })
  }
}

export class OperationCancelledError extends ConnectorError {
  public override readonly name = "OperationCancelledError"
  public constructor(public readonly operation: string) {
    super("connector operation cancelled", {
      code: "operation-cancelled",
      retryable: false,
      cause: null,
    })
  }
}

export class DeadlineExceededError extends ConnectorError {
  public override readonly name = "DeadlineExceededError"
  public constructor(public readonly timeoutMs: number) {
    super("connector deadline exceeded", {
      code: "deadline-exceeded",
      retryable: true,
      cause: null,
    })
  }
}

export class ResourceDisposedError extends ConnectorError {
  public override readonly name = "ResourceDisposedError"
  public constructor(public readonly resource: string) {
    super("connector resource disposed", {
      code: "resource-disposed",
      retryable: false,
      cause: null,
    })
  }
}

type InfrastructureErrorOptions = {
  readonly operation: string
  readonly retryable: boolean
  readonly cause: unknown | null
}

export class AdapterError extends ConnectorError {
  public override readonly name = "AdapterError"
  public readonly operation: string
  public readonly providerId: ProviderId | null
  public constructor(
    options: InfrastructureErrorOptions & { readonly providerId: ProviderId | null },
  ) {
    super("provider adapter failed", { code: "adapter-error", ...options })
    this.operation = options.operation
    this.providerId = options.providerId
  }
}

export class HttpTransportError extends ConnectorError {
  public override readonly name = "HttpTransportError"
  public readonly operation: string
  public constructor(options: InfrastructureErrorOptions) {
    super("HTTP transport failed", { code: "http-transport-error", ...options })
    this.operation = options.operation
  }
}

export class ProcessSupervisorError extends ConnectorError {
  public override readonly name = "ProcessSupervisorError"
  public readonly operation: string
  public constructor(options: InfrastructureErrorOptions) {
    super("process supervisor failed", { code: "process-supervisor-error", ...options })
    this.operation = options.operation
  }
}
