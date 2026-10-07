// Derived from brent-weatherall/opencode-commandcode-provider src/model.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.
import { OperationCancelledError } from "../../core/errors.js"
import type { HttpRequest, HttpTransport } from "../../core/http.js"
import { type HttpBodyStream, openHttpBody } from "../../http/read-body.js"
import { commandCodeHttpError } from "./errors.js"
import { type CommandCodeRequestLifecycle, readCommandCodeErrorBody } from "./request-lifecycle.js"

type Options = {
  readonly transport: HttpTransport
  readonly lifecycle: CommandCodeRequestLifecycle
  readonly initialToken: string
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly createRequest: (token: string) => HttpRequest
}
export type OpenedCommandCodeGeneration = {
  readonly opened: HttpBodyStream
  readonly request: HttpRequest
}

async function openAttempt(options: Options, token: string): Promise<OpenedCommandCodeGeneration> {
  const request = options.createRequest(token)
  const opened = await openHttpBody(options.transport, request, options.lifecycle.signal)
  if (options.lifecycle.signal.aborted) {
    await opened.chunks[Symbol.asyncIterator]().return?.()
    throw new OperationCancelledError("command-code-stream")
  }
  return { opened, request }
}

async function responseError(
  opened: HttpBodyStream,
  lifecycle: CommandCodeRequestLifecycle,
): Promise<ReturnType<typeof commandCodeHttpError>> {
  try {
    return commandCodeHttpError(opened.status, await readCommandCodeErrorBody(opened.chunks))
  } catch (error) {
    lifecycle.abort()
    throw error
  }
}

export async function openCommandCodeGeneration(
  options: Options,
): Promise<OpenedCommandCodeGeneration> {
  const first = await openAttempt(options, options.initialToken)
  if (first.opened.status >= 200 && first.opened.status < 300) return first
  const firstError = await responseError(first.opened, options.lifecycle)
  if (first.opened.status !== 401) throw firstError
  const reloaded = await options.readAccessToken(options.lifecycle.signal)
  if (options.lifecycle.signal.aborted) throw new OperationCancelledError("command-code-stream")
  if (reloaded === null || reloaded === options.initialToken) throw firstError
  const second = await openAttempt(options, reloaded)
  if (second.opened.status >= 200 && second.opened.status < 300) return second
  throw await responseError(second.opened, options.lifecycle)
}
