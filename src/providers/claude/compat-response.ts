// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { stripClaudeToolPrefix } from "./compat-transform.js"

export function transformClaudeResponse(response: Response): Response {
  if (response.body === null) {
    return response
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      if (!response.ok) {
        const next = await reader.read()
        if (next.done) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(stripClaudeToolPrefix(decoder.decode(next.value))))
        return
      }
      for (;;) {
        const boundary = buffer.indexOf("\n\n")
        if (boundary !== -1) {
          const event = buffer.slice(0, boundary + 2)
          buffer = buffer.slice(boundary + 2)
          controller.enqueue(encoder.encode(stripClaudeToolPrefix(event)))
          return
        }
        const next = await reader.read()
        if (next.done) {
          if (buffer.length > 0) {
            controller.enqueue(encoder.encode(stripClaudeToolPrefix(buffer)))
            buffer = ""
          } else {
            controller.close()
          }
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
