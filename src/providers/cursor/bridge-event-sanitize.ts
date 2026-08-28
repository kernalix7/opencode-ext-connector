import type { BridgeEvent } from "./bridge-protocol"

function assertNever(event: never): never {
  void event
  throw new TypeError("unexpected bridge event")
}

function redactExactToken(value: string, accessToken: string): string {
  return accessToken.length === 0 ? value : value.split(accessToken).join("[REDACTED]")
}

function containsExactToken(value: string, accessToken: string): boolean {
  return accessToken.length > 0 && value.includes(accessToken)
}

export function isSensitiveBridgeHeader(name: string): boolean {
  return (
    name === "authorization" ||
    name === "proxy-authorization" ||
    name === "cookie" ||
    name === "set-cookie" ||
    name.includes("token") ||
    name.includes("api-key") ||
    name.includes("apikey") ||
    name.includes("api_key") ||
    name.includes("secret") ||
    name.includes("password")
  )
}

function sanitizeHeaders(
  headers: Readonly<Record<string, string>>,
  accessToken: string,
): Readonly<Record<string, string>> {
  const sanitized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!isSensitiveBridgeHeader(name) && !containsExactToken(name, accessToken)) {
      sanitized[name] = redactExactToken(value, accessToken)
    }
  }
  return sanitized
}

export function sanitizeBridgeEvent(event: BridgeEvent, accessToken: string): BridgeEvent {
  switch (event.kind) {
    case "opened":
    case "data":
    case "end":
      return event
    case "headers":
    case "trailers":
      return { ...event, headers: sanitizeHeaders(event.headers, accessToken) }
    case "error":
      return {
        ...event,
        message: redactExactToken(event.message, accessToken),
      }
    default:
      return assertNever(event)
  }
}
