// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { stripClaudeToolPrefix } from "./compat-transform.js"

export function transformClaudeResponse(response: Response, signal?: AbortSignal): Response {
  if (response.body === null) return response
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      if (signal?.aborted) {
        await reader.cancel()
        controller.error(signal.reason)
        return
      }
      for (;;) {
        const boundary = response.ok
          ? buffer.indexOf("\n\n")
          : buffer.length > 0
            ? buffer.length
            : -1
        if (boundary !== -1) {
          const end = response.ok ? boundary + 2 : boundary
          const event = buffer.slice(0, end)
          buffer = buffer.slice(end)
          controller.enqueue(encoder.encode(stripClaudeToolPrefix(event)))
          return
        }
        const next = await reader.read()
        if (signal?.aborted) {
          await reader.cancel()
          controller.error(signal.reason)
          return
        }
        if (next.done) {
          buffer += decoder.decode()
          if (buffer.length > 0) {
            controller.enqueue(encoder.encode(stripClaudeToolPrefix(buffer)))
            buffer = ""
          } else controller.close()
          return
        }
        buffer += decoder.decode(next.value, { stream: true })
      }
    },
    async cancel(reason): Promise<void> {
      await reader.cancel(reason)
    },
  })
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
