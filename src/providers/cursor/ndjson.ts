// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

function textFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value
  }
  if (typeof value !== "object" || value === null) {
    return null
  }
  if ("text" in value && typeof value.text === "string") {
    return value.text
  }
  if ("delta" in value && typeof value.delta === "string") {
    return value.delta
  }
  if ("result" in value && typeof value.result === "string") {
    return value.result
  }
  if ("message" in value) {
    return textFromUnknown(value.message)
  }
  if ("content" in value) {
    const content = value.content
    if (typeof content === "string") {
      return content
    }
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const part of content) {
        const text = textFromUnknown(part)
        if (text !== null) {
          parts.push(text)
        }
      }
      return parts.length > 0 ? parts.join("") : null
    }
  }
  return null
}

export function extractCursorNdjsonText(stream: string): string {
  const parts: string[] = []
  for (const line of stream.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue
    }
    const type = "type" in parsed && typeof parsed.type === "string" ? parsed.type : ""
    if (type === "thinking") {
      continue
    }
    const text = textFromUnknown(parsed)
    if (text !== null) {
      parts.push(text)
    }
  }
  return parts.join("")
}
