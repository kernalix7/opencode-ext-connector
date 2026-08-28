import {
  type BridgeCommand,
  type BridgeEvent,
  type BridgeLineDecoder,
  CursorBridgeProtocolError,
  createBridgeCommandLineDecoder,
  createBridgeEventLineDecoder,
  sanitizeBridgeEvent,
} from "../../src/providers/cursor/bridge-protocol"

export type FakeCursorBridgeCommand =
  | {
      readonly kind: "open"
      readonly id: string
      readonly path: string
      readonly headers: Readonly<Record<string, string>>
    }
  | { readonly kind: "write-frame"; readonly id: string; readonly payload: Uint8Array }
  | { readonly kind: "abort"; readonly id: string }
  | { readonly kind: "close"; readonly id: string }

export type FakeCursorBridgeOptions = { readonly accessToken: string }

function assertNever(command: never): never {
  void command
  throw new CursorBridgeProtocolError("invalid-message")
}

function redactCommand(command: BridgeCommand): FakeCursorBridgeCommand {
  switch (command.kind) {
    case "open":
      return { kind: command.kind, id: command.id, path: command.path, headers: command.headers }
    case "write-frame":
      return { kind: command.kind, id: command.id, payload: new Uint8Array(command.payload) }
    case "abort":
    case "close":
      return command
    default:
      return assertNever(command)
  }
}

/** In-memory control transport; its public recording intentionally omits access tokens. */
export class FakeCursorBridge {
  public readonly commands: FakeCursorBridgeCommand[] = []
  public readonly events: BridgeEvent[] = []
  private readonly commandDecoder: BridgeLineDecoder<BridgeCommand> =
    createBridgeCommandLineDecoder()
  private readonly eventDecoder: BridgeLineDecoder<BridgeEvent> = createBridgeEventLineDecoder()
  private readonly accessToken: string

  public constructor(options: FakeCursorBridgeOptions) {
    this.accessToken = options.accessToken
  }

  public receiveCommandChunk(chunk: string): void {
    for (const command of this.commandDecoder.push(chunk)) {
      this.commands.push(redactCommand(command))
    }
  }
  public receiveEventChunk(chunk: string): void {
    for (const event of this.eventDecoder.push(chunk)) {
      this.events.push(sanitizeBridgeEvent(event, this.accessToken))
    }
  }
  public finishCommands(): void {
    this.commandDecoder.finish()
  }
  public finishEvents(): void {
    this.eventDecoder.finish()
  }
}
