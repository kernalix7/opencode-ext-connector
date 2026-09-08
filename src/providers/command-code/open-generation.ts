// Derived from brent-weatherall/opencode-commandcode-provider src/model.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { OperationCancelledError } from "../../core/errors.js"
import type { HttpRequest, HttpTransport } from "../../core/http.js"
import { type HttpBodyStream, openHttpBody } from "../../http/read-body.js"
import type { CommandCodeRequestLifecycle } from "./request-lifecycle.js"
import { commandCodeHttpError, readCommandCodeErrorBody } from "./request-lifecycle.js"

type OpenGenerationOptions = {
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

async function openAttempt(
  options: OpenGenerationOptions,
  request: HttpRequest,
): Promise<OpenedCommandCodeGeneration> {
  const opened = await openHttpBody(options.transport, request, options.lifecycle.signal)
  return { opened, request }
}

async function responseError(
  opened: HttpBodyStream,
  lifecycle: CommandCodeRequestLifecycle,
): Promise<ReturnType<typeof commandCodeHttpError>> {
  try {
    const body = await readCommandCodeErrorBody(opened.chunks)
    return commandCodeHttpError(opened.status, body)
  } catch (error) {
    lifecycle.abort()
    throw error
  }
}

function successful(opened: HttpBodyStream): boolean {
  return opened.status >= 200 && opened.status < 300
}

export async function openCommandCodeGeneration(
  options: OpenGenerationOptions,
): Promise<OpenedCommandCodeGeneration> {
  const firstRequest = options.createRequest(options.initialToken)
  const first = await openAttempt(options, firstRequest)
  if (successful(first.opened)) return first

  const firstError = await responseError(first.opened, options.lifecycle)
  if (first.opened.status !== 401) throw firstError

  const reloadedToken = await options.readAccessToken(options.lifecycle.signal)
  if (options.lifecycle.signal.aborted) {
    throw new OperationCancelledError("command-code-stream")
  }
  if (reloadedToken === null) throw firstError

  const candidateRequest = options.createRequest(reloadedToken)
  if (candidateRequest.headers["authorization"] === firstRequest.headers["authorization"]) {
    throw firstError
  }

  const second = await openAttempt(options, candidateRequest)
  if (successful(second.opened)) return second
  throw await responseError(second.opened, options.lifecycle)
}
