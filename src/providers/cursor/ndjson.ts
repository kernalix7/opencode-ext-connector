// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

export function cursorTextFromUnknown(value: unknown): string | null {
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
    return cursorTextFromUnknown(value.message)
  }
  if ("content" in value) {
    const content = value.content
    if (typeof content === "string") {
      return content
    }
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const part of content) {
        const text = cursorTextFromUnknown(part)
        if (text !== null) {
          parts.push(text)
        }
      }
      return parts.length > 0 ? parts.join("") : null
    }
  }
  return null
}

export function cursorResultError(value: object): Error | null {
  const isError = "is_error" in value && value.is_error === true
  const subtype = "subtype" in value && typeof value.subtype === "string" ? value.subtype : ""
  const exitCode =
    "exitCode" in value && typeof value.exitCode === "number"
      ? value.exitCode
      : "exit_code" in value && typeof value.exit_code === "number"
        ? value.exit_code
        : 0
  if (!isError && !subtype.includes("error") && exitCode === 0) {
    return null
  }
  return new Error(cursorTextFromUnknown(value) ?? (subtype || `cursor-agent exited ${exitCode}`))
}

export function extractCursorNdjsonText(stream: string): string {
  const parts: string[] = []
  let assistantText = ""
  let resultText = ""
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
    if (type !== "assistant" && type !== "text" && type !== "text-delta" && type !== "result") {
      continue
    }
    const text = cursorTextFromUnknown(parsed)
    if (text !== null) {
      if (type === "assistant") {
        const delta = text.startsWith(assistantText) ? text.slice(assistantText.length) : text
        assistantText = text
        if (delta.length > 0) {
          parts.push(delta)
        }
        continue
      }
      if (type === "result") {
        resultText = text
        continue
      }
      parts.push(text)
    }
  }
  if (assistantText.length === 0 && resultText.length > 0) {
    parts.push(resultText)
  }
  return parts.join("")
}
