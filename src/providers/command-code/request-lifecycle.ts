import { OperationCancelledError } from "../../core/errors.js"
import { commandCodeResponseBodyTooLargeError } from "./errors.js"

export { commandCodeHttpError } from "./errors.js"

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
    if (!controller.signal.aborted)
      controller.abort(new OperationCancelledError("command-code-stream"))
  }
  parent?.addEventListener("abort", abort, { once: true })
  if (parent?.aborted) abort()
  const handle = setTimeout(abort, timeoutMs)
  handle.unref()
  return {
    signal: controller.signal,
    abort,
    dispose: () => {
      clearTimeout(handle)
      parent?.removeEventListener("abort", abort)
    },
  }
}
export async function readCommandCodeErrorBody(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let result = "",
    length = 0
  for await (const chunk of chunks) {
    length += chunk.byteLength
    if (length > 64 * 1024) throw commandCodeResponseBodyTooLargeError()
    result += decoder.decode(chunk, { stream: true })
  }
  return result + decoder.decode()
}
