export type CursorProtocolReason =
  | "malformed"
  | "truncated"
  | "wrong-wire"
  | "oversized"
  | "unsupported-flags"

export class CursorProtocolError extends Error {
  public override readonly name = "CursorProtocolError"
  public readonly code = "CURSOR_PROTOCOL_ERROR"

  public constructor(
    public readonly reason: CursorProtocolReason,
    public readonly context: string,
    detail: string,
  ) {
    super(`${context}: ${reason}: ${detail}`)
  }
}

export class CursorProtocolDriftError extends Error {
  public override readonly name = "CursorProtocolDriftError"
  public readonly code = "CURSOR_PROTOCOL_DRIFT"

  public constructor(
    public readonly context: string,
    public readonly field: number,
    detail = "unsupported protobuf field or variant",
  ) {
    super(`${context}: field ${field}: ${detail}`)
  }
}

export function unreachableVariant(value: never, context: string): never {
  void value
  throw new CursorProtocolDriftError(context, 0, "unsupported internal variant")
}
