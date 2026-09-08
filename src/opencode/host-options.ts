import type { ConnectorOptionsInput } from "../core/options.js"

type HostConnectorOptionsInput = Omit<
  ConnectorOptionsInput,
  "credentialManagement" | "credentialRefresh" | "writeBackCredentials"
> & {
  readonly credentialManagement?: unknown
  readonly credentialRefresh?: unknown
  readonly writeBackCredentials?: unknown
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function pickCredentialRefresh(value: unknown): ConnectorOptionsInput["credentialRefresh"] {
  if (typeof value !== "object" || value === null) {
    return undefined
  }
  const rawMode = "mode" in value ? value.mode : undefined
  const mode = rawMode === "auto" || rawMode === "never" ? rawMode : undefined
  const leadMs = "leadMs" in value ? nonNegativeInteger(value.leadMs) : undefined
  return { mode, leadMs }
}

function pickHealth(value: unknown): ConnectorOptionsInput["health"] {
  if (typeof value !== "object" || value === null) {
    return undefined
  }
  const initialBackoffMs =
    "initialBackoffMs" in value ? positiveInteger(value.initialBackoffMs) : undefined
  const maximumBackoffMs =
    "maximumBackoffMs" in value ? positiveInteger(value.maximumBackoffMs) : undefined
  if (initialBackoffMs === undefined && maximumBackoffMs === undefined) {
    return undefined
  }
  return { initialBackoffMs, maximumBackoffMs }
}

export function pickConnectorOptionsInput(input: unknown): HostConnectorOptionsInput {
  if (typeof input !== "object" || input === null) {
    return {}
  }
  const preservesCredentialPolicy =
    "credentialManagement" in input &&
    (input.credentialManagement === "connector" || input.credentialManagement === "external")
  const writeBackCredentials =
    "writeBackCredentials" in input && input.writeBackCredentials !== undefined
      ? preservesCredentialPolicy
        ? input.writeBackCredentials
        : typeof input.writeBackCredentials === "boolean"
          ? input.writeBackCredentials
          : undefined
      : undefined
  const credentialRefresh =
    "credentialRefresh" in input && input.credentialRefresh !== undefined
      ? preservesCredentialPolicy
        ? input.credentialRefresh
        : pickCredentialRefresh(input.credentialRefresh)
      : undefined
  return {
    providers:
      "providers" in input && Array.isArray(input.providers)
        ? input.providers.filter(
            (provider): provider is "claude" | "cursor" | "command-code" | "ollama" =>
              provider === "claude" ||
              provider === "cursor" ||
              provider === "command-code" ||
              provider === "ollama",
          )
        : undefined,
    snapshotTimeoutMs:
      "snapshotTimeoutMs" in input ? positiveInteger(input.snapshotTimeoutMs) : undefined,
    ...(writeBackCredentials === undefined ? {} : { writeBackCredentials }),
    ...(!("credentialManagement" in input) || input.credentialManagement === undefined
      ? {}
      : { credentialManagement: input.credentialManagement }),
    ...(credentialRefresh === undefined ? {} : { credentialRefresh }),
    catalogReloadMs:
      "catalogReloadMs" in input ? nonNegativeInteger(input.catalogReloadMs) : undefined,
    health: "health" in input ? pickHealth(input.health) : undefined,
  }
}

export function pickOllamaBaseURL(input: unknown): unknown {
  return typeof input === "object" && input !== null && "ollamaBaseURL" in input
    ? input.ollamaBaseURL
    : undefined
}
