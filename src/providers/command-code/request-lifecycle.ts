import { OperationCancelledError } from "../../core/errors"

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
  for await (const chunk of chunks) {
    result += decoder.decode(chunk, { stream: true })
  }
  return result + decoder.decode()
}

export function commandCodeHttpError(
  status: number,
  statusText: string | undefined,
  body: string,
  modelId: string,
): Error {
  let message = `Command Code API error: ${status} ${statusText ?? ""}`.trim()
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === "object" && parsed !== null) {
      const error = "error" in parsed ? parsed.error : undefined
      const candidate =
        typeof error === "object" && error !== null && "message" in error
          ? error.message
          : "message" in parsed
            ? parsed.message
            : undefined
      if (typeof candidate === "string") {
        message = candidate
      }
    }
  } catch {}
  return new Error(`${message} [model=${modelId}]`)
}
