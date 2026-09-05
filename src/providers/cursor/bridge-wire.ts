import { Buffer } from "node:buffer"

import { z } from "zod"

import { isSensitiveBridgeHeader } from "./bridge-event-sanitize.js"
import { MAX_BRIDGE_BASE64_CHARACTERS, MAX_BRIDGE_LINE_LENGTH } from "./bridge-limits.js"
import {
  type BridgeCommand,
  type BridgeEvent,
  CursorBridgeProtocolError,
} from "./bridge-protocol.js"

const BridgeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const HeaderNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/)
const HeaderValueSchema = z
  .string()
  .max(8192)
  .refine((value) => !/[\r\n]/.test(value))
const HeadersSchema = z.record(HeaderNameSchema, HeaderValueSchema)
const OpenHeadersSchema = z.record(
  HeaderNameSchema.refine((value) => !isSensitiveBridgeHeader(value)),
  HeaderValueSchema,
)
const PathSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^\/[^\r\n]*$/)
const AccessTokenSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => !/[\r\n]/.test(value))

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0) {
    return true
  }
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return false
  }
  return Buffer.from(value, "base64").toString("base64") === value
}

const Base64Schema = z.string().max(MAX_BRIDGE_BASE64_CHARACTERS).refine(isCanonicalBase64, {
  message: "invalid-base64",
})
const OpenCommandSchema = z
  .object({
    kind: z.literal("open"),
    id: BridgeIdSchema,
    accessToken: AccessTokenSchema,
    path: PathSchema,
    headers: OpenHeadersSchema,
  })
  .strict()
const WriteFrameCommandSchema = z
  .object({ kind: z.literal("write-frame"), id: BridgeIdSchema, payload: Base64Schema })
  .strict()
const AbortCommandSchema = z.object({ kind: z.literal("abort"), id: BridgeIdSchema }).strict()
const CloseCommandSchema = z.object({ kind: z.literal("close"), id: BridgeIdSchema }).strict()
const CommandSchema = z.discriminatedUnion("kind", [
  OpenCommandSchema,
  WriteFrameCommandSchema,
  AbortCommandSchema,
  CloseCommandSchema,
])
const OpenedEventSchema = z.object({ kind: z.literal("opened"), id: BridgeIdSchema }).strict()
const HeadersEventSchema = z
  .object({
    kind: z.literal("headers"),
    id: BridgeIdSchema,
    status: z.number().int().min(100).max(599),
    headers: HeadersSchema,
  })
  .strict()
const DataEventSchema = z
  .object({ kind: z.literal("data"), id: BridgeIdSchema, payload: Base64Schema })
  .strict()
const TrailersEventSchema = z
  .object({ kind: z.literal("trailers"), id: BridgeIdSchema, headers: HeadersSchema })
  .strict()
const EndEventSchema = z.object({ kind: z.literal("end"), id: BridgeIdSchema }).strict()
const ErrorEventSchema = z
  .object({
    kind: z.literal("error"),
    id: BridgeIdSchema,
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4096),
  })
  .strict()
const EventSchema = z.discriminatedUnion("kind", [
  OpenedEventSchema,
  HeadersEventSchema,
  DataEventSchema,
  TrailersEventSchema,
  EndEventSchema,
  ErrorEventSchema,
])

type WireCommand = z.output<typeof CommandSchema>
type WireEvent = z.output<typeof EventSchema>

function assertNever(value: never): never {
  void value
  throw new CursorBridgeProtocolError("invalid-message")
}

function parseJson(line: string): unknown {
  if (line.length > MAX_BRIDGE_LINE_LENGTH) {
    throw new CursorBridgeProtocolError("line-too-long")
  }
  try {
    return JSON.parse(line)
  } catch {
    throw new CursorBridgeProtocolError("malformed-json")
  }
}

function parseWireCommand(line: string): WireCommand {
  const result = CommandSchema.safeParse(parseJson(line))
  if (!result.success) {
    const code = result.error.issues.some((issue) => issue.message === "invalid-base64")
      ? "invalid-base64"
      : "invalid-message"
    throw new CursorBridgeProtocolError(code)
  }
  return result.data
}

function parseWireEvent(line: string): WireEvent {
  const result = EventSchema.safeParse(parseJson(line))
  if (!result.success) {
    const code = result.error.issues.some((issue) => issue.message === "invalid-base64")
      ? "invalid-base64"
      : "invalid-message"
    throw new CursorBridgeProtocolError(code)
  }
  return result.data
}

function decodeBase64(payload: string): Uint8Array {
  return new Uint8Array(Buffer.from(payload, "base64"))
}

export function parseBridgeCommandLine(line: string): BridgeCommand {
  const command = parseWireCommand(line)
  switch (command.kind) {
    case "open":
      return command
    case "write-frame":
      return { kind: command.kind, id: command.id, payload: decodeBase64(command.payload) }
    case "abort":
    case "close":
      return command
    default:
      return assertNever(command)
  }
}

export function parseBridgeEventLine(line: string): BridgeEvent {
  const event = parseWireEvent(line)
  switch (event.kind) {
    case "opened":
    case "headers":
    case "trailers":
    case "end":
    case "error":
      return event
    case "data":
      return { kind: event.kind, id: event.id, payload: decodeBase64(event.payload) }
    default:
      return assertNever(event)
  }
}
