// Derived from Rahularya01/pi-cursor's Node HTTP/2 child. Licensed under MIT.
// See THIRD_PARTY_NOTICES.md.

import { fileURLToPath } from "node:url"

import { z } from "zod"

import {
  type BridgeEvent,
  CursorBridgeProtocolError,
  createBridgeCommandLineDecoder,
  serializeBridgeEvent,
} from "./bridge-protocol.js"
import { type CursorH2BridgeOutput, CursorH2BridgeSession } from "./h2-bridge-session.js"
import { CURSOR_API_URL } from "./http2.js"

const EndpointSchema = z
  .url()
  .transform((value) => new URL(value))
  .refine((value) => value.protocol === "http:" || value.protocol === "https:")
  .refine(
    (value) =>
      value.username.length === 0 &&
      value.password.length === 0 &&
      value.search.length === 0 &&
      value.hash.length === 0 &&
      value.pathname === "/",
  )
  .transform((value) => value.origin)

function emit(output: CursorH2BridgeOutput): boolean {
  return process.stdout.write(
    serializeBridgeEvent(output.event, { accessToken: output.accessToken }),
  )
}

function emitProtocolError(error: CursorBridgeProtocolError): void {
  const event: BridgeEvent = {
    kind: "error",
    id: "bridge",
    code: error.code,
    message: "Cursor bridge command was rejected",
  }
  process.stdout.write(serializeBridgeEvent(event, { accessToken: "" }))
}

export function resolveCursorH2Endpoint(endpoint?: string): string {
  return EndpointSchema.parse(endpoint ?? CURSOR_API_URL)
}

export async function runCursorH2Bridge(endpoint?: string): Promise<number> {
  const decoder = createBridgeCommandLineDecoder()
  const session = new CursorH2BridgeSession(resolveCursorH2Endpoint(endpoint), emit)
  const text = new TextDecoder()
  try {
    for await (const value of process.stdin) {
      const chunk: unknown = value
      if (!Buffer.isBuffer(chunk)) {
        throw new TypeError("Cursor bridge stdin produced a non-buffer chunk")
      }
      for (const command of decoder.push(text.decode(chunk, { stream: true }))) {
        await session.handle(command)
      }
    }
    const trailing = text.decode()
    for (const command of decoder.push(trailing)) {
      await session.handle(command)
    }
    decoder.finish()
    await session.close()
    return 0
  } catch (error) {
    if (error instanceof CursorBridgeProtocolError) {
      emitProtocolError(error)
      await session.close()
      return 1
    }
    await session.close()
    return 1
  }
}

const entryPath = process.argv[1]
if (entryPath !== undefined && fileURLToPath(import.meta.url) === entryPath) {
  process.exitCode = await runCursorH2Bridge(process.argv[2])
}
