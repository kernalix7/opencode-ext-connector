import type { AuthHook } from "@opencode-ai/plugin"

import type { ProviderAdapter } from "../core/adapter.js"
import type { Clock } from "../core/clock.js"
import type { HttpTransport } from "../core/http.js"
import type { CredentialRefreshPolicy } from "../core/options.js"
import type { OpenCodeAuthStore } from "./auth-store.js"
import type { IntegrationEnvMethod } from "./beta-api.js"

export type ProviderEntryDeps = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly transport: HttpTransport
  readonly clock: Clock
  readonly authStore: OpenCodeAuthStore
  readonly writeBackCredentials: boolean
  readonly credentialRefresh?: CredentialRefreshPolicy
}

export type ProviderEntry = {
  readonly id: string
  readonly displayName: string
  readonly integrationId: string
  readonly integrationMethod: IntegrationEnvMethod
  readonly fallbackModelIds?: readonly string[]
  readonly createAdapter: (deps: ProviderEntryDeps) => ProviderAdapter
  readonly createAuthHook: (deps: ProviderEntryDeps) => AuthHook
  readonly isConnected: (deps: ProviderEntryDeps) => Promise<boolean>
}
