function stringField(value: object, key: string): string | null {
  if (!(key in value)) {
    return null
  }
  const field = Reflect.get(value, key)
  return typeof field === "string" && field.length > 0 ? field : null
}

export function extractCursorSessionId(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null
  }
  return (
    stringField(parsed, "session_id") ??
    stringField(parsed, "chatId") ??
    stringField(parsed, "resumeId")
  )
}
