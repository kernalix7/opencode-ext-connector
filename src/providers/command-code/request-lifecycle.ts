import { OperationCancelledError } from "../../core/errors"
import { commandCodeResponseBodyTooLargeError } from "./errors"

export { commandCodeHttpError } from "./errors"

const MAX_ERROR_BODY_BYTES = 64 * 1024

export type CommandCodeRequestLifecycle = {
  readonly signal: AbortSignal
  readonly abort: () => void
  readonly dispose: () => void
}

export function createCommandCodeRequestLifecycle(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): CommandCodeRequestLifecycle {
  const controller = new AbortController()
  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new OperationCancelledError("command-code-stream"))
    }
  }
  parent?.addEventListener("abort", abort, { once: true })
  const handle = setTimeout(abort, timeoutMs)
  handle.unref()
  const dispose = (): void => {
    clearTimeout(handle)
    parent?.removeEventListener("abort", abort)
  }
  return { signal: controller.signal, abort, dispose }
}

export async function readCommandCodeErrorBody(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let result = ""
  let byteLength = 0
  for await (const chunk of chunks) {
    byteLength += chunk.byteLength
    if (byteLength > MAX_ERROR_BODY_BYTES) {
      throw commandCodeResponseBodyTooLargeError()
    }
    result += decoder.decode(chunk, { stream: true })
  }
  return result + decoder.decode()
}
