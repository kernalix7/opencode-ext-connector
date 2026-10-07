import { InvalidArgumentError } from "../core/errors.js"
import type { OpenCodeAuthMatch, OpenCodeAuthProvider, OpenCodeAuthStore } from "./auth-store.js"
import type { CredentialV2, PluginV2ConnectionInfo, PluginV2IntegrationEditor } from "./beta-api.js"
import { PluginV2ClientError } from "./beta-api.js"
import type { ProviderEntry } from "./provider-entry.js"

export type V2ConnectionSource = {
  readonly active: (integrationID: string) => Promise<PluginV2ConnectionInfo | undefined>
  readonly resolve: (connection: PluginV2ConnectionInfo) => Promise<CredentialV2.Value | undefined>
}

export type V2AuthStoreOptions = {
  readonly connection: V2ConnectionSource
  readonly entries: readonly ProviderEntry[]
}

const authProviders = ["anthropic", "command-code", "ollama"] as const

function assertNever(value: never): never {
  throw new InvalidArgumentError("v2-connection", value)
}

function isAuthProvider(value: string): value is (typeof authProviders)[number] {
  return authProviders.some((provider) => provider === value)
}

function isBoundaryFailure(error: unknown): boolean {
  return (
    error instanceof PluginV2ClientError ||
    (error instanceof DOMException && error.name === "AbortError")
  )
}

function matchKey(
  provider: OpenCodeAuthProvider,
  key: string,
  connectionId?: string,
): OpenCodeAuthMatch | null {
  if (provider === "ollama")
    return key === "cli-session:ollama"
      ? { kind: "marker", ...(connectionId === undefined ? {} : { connectionId }) }
      : null
  if (key === (provider === "claude" ? "cli-session:anthropic" : "cli-session:command-code"))
    return { kind: "marker", ...(connectionId === undefined ? {} : { connectionId }) }
  if (provider === "claude" || key.length === 0 || key.startsWith("cli-session:")) return null
  return { kind: "api-key", key, ...(connectionId === undefined ? {} : { connectionId }) }
}

async function matchCredential(
  source: V2ConnectionSource,
  provider: OpenCodeAuthProvider,
  connection: PluginV2ConnectionInfo,
): Promise<OpenCodeAuthMatch | null> {
  let value: CredentialV2.Value | undefined
  try {
    value = await source.resolve(connection)
  } catch (error: unknown) {
    if (isBoundaryFailure(error)) return null
    throw error
  }
  if (value === undefined) return null
  if (connection.type === "credential" && connection.method === "oauth") {
    return provider === "claude" && value.type === "oauth"
      ? { kind: "oauth", key: value.access, connectionId: connection.id }
      : null
  }
  switch (value.type) {
    case "oauth":
      return null
    case "key":
      return matchKey(
        provider,
        value.key,
        connection.type === "credential" ? connection.id : connection.name,
      )
    default:
      return assertNever(value)
  }
}

export function createV2AuthStore(options: V2AuthStoreOptions): OpenCodeAuthStore {
  const entries = new Map<string, ProviderEntry>(
    options.entries.flatMap((entry) =>
      isAuthProvider(entry.integrationId) ? [[entry.integrationId, entry] as const] : [],
    ),
  )
  return {
    matchAuth: async (provider): Promise<OpenCodeAuthMatch | null> => {
      const entry = entries.get(provider === "claude" ? "anthropic" : provider)
      if (entry === undefined) return null
      let connection: PluginV2ConnectionInfo | undefined
      try {
        connection = await options.connection.active(entry.integrationId)
      } catch (error: unknown) {
        if (isBoundaryFailure(error)) return null
        throw error
      }
      if (connection === undefined || connection.status !== undefined) return null
      switch (connection.type) {
        case "env":
          return entry.integrationMethod.names.includes(connection.name)
            ? matchCredential(options.connection, provider, connection)
            : null
        case "credential":
          return connection.method === "key" ||
            (provider === "claude" && connection.method === "oauth")
            ? matchCredential(options.connection, provider, connection)
            : null
        default:
          return assertNever(connection)
      }
    },
  }
}

export function registerV2IntegrationMethods(
  entries: readonly ProviderEntry[],
  editor: PluginV2IntegrationEditor,
): void {
  for (const entry of entries) {
    editor.method.update({ integrationID: entry.integrationId, method: entry.integrationMethod })
    editor.method.update({
      integrationID: entry.integrationId,
      method: {
        type: "key",
        label:
          entry.integrationId === "command-code" ? "Command Code key or session" : "CLI session",
      },
    })
  }
}
