import { CursorProtocolError } from "./proto/errors.js"

export type CursorProtocolFailureStage = "connect-frame" | "server-dispatch"

export type CursorProtocolDiagnosticContext =
  | "AgentServerMessage"
  | "Connect end-stream"
  | "Connect stream"
  | "HeartbeatUpdate"
  | "InteractionUpdate"
  | "TextDeltaUpdate"
  | "ThinkingDeltaUpdate"
  | "TokenDeltaUpdate"
  | "TurnEndedUpdate"
  | "other"

export type CursorProtocolFailureProjection = {
  readonly context: CursorProtocolDiagnosticContext
  readonly reason: CursorProtocolError["reason"]
  readonly stage: CursorProtocolFailureStage
}

function diagnosticContext(context: string): CursorProtocolDiagnosticContext {
  switch (context) {
    case "AgentServerMessage":
    case "Connect end-stream":
    case "Connect stream":
    case "HeartbeatUpdate":
    case "InteractionUpdate":
    case "TextDeltaUpdate":
    case "ThinkingDeltaUpdate":
    case "TokenDeltaUpdate":
    case "TurnEndedUpdate":
      return context
    default:
      return "other"
  }
}

export class CursorProtocolFailure extends Error {
  public override readonly name = "CursorProtocolFailure"
  public readonly code = "CURSOR_PROTOCOL_FAILURE"

  public constructor(
    error: CursorProtocolError,
    public readonly stage: CursorProtocolFailureStage,
  ) {
    super(error.message, { cause: error })
    this.context = error.context
    this.reason = error.reason
  }

  public readonly reason: CursorProtocolError["reason"]
  public readonly context: string
}

export function annotateCursorProtocolFailure(
  error: unknown,
  stage: CursorProtocolFailureStage,
): never {
  if (error instanceof CursorProtocolError) {
    throw new CursorProtocolFailure(error, stage)
  }
  throw error
}

export function projectCursorProtocolFailure(
  error: unknown,
): CursorProtocolFailureProjection | null {
  if (!(error instanceof CursorProtocolFailure)) return null
  return {
    context: diagnosticContext(error.context),
    reason: error.reason,
    stage: error.stage,
  }
}
