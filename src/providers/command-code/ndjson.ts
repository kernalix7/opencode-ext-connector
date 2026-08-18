// Derived from thaolaptrinh/commandcode-api-proxy@f4b3390e2f18a42bc164a1a94a4d796e20d19700.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

export type NdjsonDelta = {
  readonly type: "text-delta"
  readonly id: string
  readonly delta: string
}

export type NdjsonEvent =
  | { readonly type: "stream-start"; readonly warnings: readonly unknown[] }
  | NdjsonDelta
  | { readonly type: "text-start"; readonly id: string }
  | { readonly type: "text-end"; readonly id: string }
  | {
      readonly type: "finish"
      readonly finishReason: { readonly unified: string; readonly raw: string }
      readonly usage: {
        readonly inputTokens: {
          readonly total: number | undefined
          readonly noCache: number | undefined
          readonly cacheRead: number | undefined
          readonly cacheWrite: number | undefined
        }
        readonly outputTokens: {
          readonly total: number | undefined
          readonly text: number | undefined
          readonly reasoning: number | undefined
        }
      }
    }

function isTextDeltaCandidate(
  value: unknown,
): value is { readonly type?: unknown; readonly text?: unknown; readonly data?: unknown } {
  return typeof value === "object" && value !== null
}

function hasTextDeltaType(value: { readonly type?: unknown }): boolean {
  return value.type === "text-delta"
}

function hasTextProperty(value: { readonly text?: unknown }): value is { readonly text: string } {
  return typeof value.text === "string"
}

function hasDataWithText(value: {
  readonly data?: unknown
}): value is { readonly data: { readonly text: string } } {
  return typeof value.data === "object" && value.data !== null && hasTextProperty(value.data)
}

function parseLine(line: string): NdjsonDelta | null {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed === "[DONE]") {
    return null
  }
  const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed
  if (payload.length === 0 || payload === "[DONE]") {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (!isTextDeltaCandidate(parsed)) {
    return null
  }
  if (!hasTextDeltaType(parsed)) {
    return null
  }
  if (hasTextProperty(parsed)) {
    return { type: "text-delta", id: "text-1", delta: parsed.text }
  }
  if (hasDataWithText(parsed)) {
    return { type: "text-delta", id: "text-1", delta: parsed.data.text }
  }
  return null
}

export function parseNdjsonStream(body: Uint8Array): NdjsonDelta[] {
  const deltas: NdjsonDelta[] = []
  const text = new TextDecoder().decode(body)
  for (const line of text.split("\n")) {
    const delta = parseLine(line)
    if (delta !== null) {
      deltas.push(delta)
    }
  }
  return deltas
}

export function createNdjsonStreamParser(): {
  readonly parse: (chunk: Uint8Array) => NdjsonDelta[]
  readonly flush: () => NdjsonDelta[]
} {
  let buffer = ""
  return {
    parse(chunk: Uint8Array): NdjsonDelta[] {
      const deltas: NdjsonDelta[] = []
      buffer += new TextDecoder().decode(chunk)
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const delta = parseLine(line)
        if (delta !== null) {
          deltas.push(delta)
        }
      }
      return deltas
    },
    flush(): NdjsonDelta[] {
      const deltas: NdjsonDelta[] = []
      if (buffer.length > 0) {
        const delta = parseLine(buffer)
        if (delta !== null) {
          deltas.push(delta)
        }
        buffer = ""
      }
      return deltas
    },
  }
}
