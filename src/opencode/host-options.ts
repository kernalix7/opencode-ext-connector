import type { ConnectorOptionsInput } from "../core/options"

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
  if (mode === undefined && leadMs === undefined) {
    return undefined
  }
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

export function pickConnectorOptionsInput(input: unknown): ConnectorOptionsInput {
  if (typeof input !== "object" || input === null) {
    return {}
  }
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
    writeBackCredentials:
      "writeBackCredentials" in input && typeof input.writeBackCredentials === "boolean"
        ? input.writeBackCredentials
        : undefined,
    credentialRefresh:
      "credentialRefresh" in input ? pickCredentialRefresh(input.credentialRefresh) : undefined,
    catalogReloadMs:
      "catalogReloadMs" in input ? nonNegativeInteger(input.catalogReloadMs) : undefined,
    health: "health" in input ? pickHealth(input.health) : undefined,
  }
}
