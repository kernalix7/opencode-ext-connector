import type { ConnectorOptionsInput } from "../core/options.js"

type HostConnectorOptionsInput = ConnectorOptionsInput & {
  readonly credentialRole?: unknown
  readonly credentialManagement?: unknown
  readonly credentialAuthority?: unknown
  readonly credentialRefresh?: unknown
  readonly writeBackCredentials?: unknown
  readonly xaiOAuth?: unknown
}

export function pickConnectorOptionsInput(input: unknown): HostConnectorOptionsInput {
  if (typeof input !== "object" || input === null) return {}
  const result: Record<string, unknown> = {}
  for (const field of [
    "providers",
    "snapshotTimeoutMs",
    "catalogReloadMs",
    "health",
    "credentialRole",
    "credentialManagement",
    "credentialAuthority",
    "credentialRefresh",
    "writeBackCredentials",
    "xaiOAuth",
  ]) {
    if (field in input) result[field] = Reflect.get(input, field)
  }
  return result
}

export function pickOllamaBaseURL(input: unknown): unknown {
  return typeof input === "object" && input !== null && "ollamaBaseURL" in input
    ? input.ollamaBaseURL
    : undefined
}
