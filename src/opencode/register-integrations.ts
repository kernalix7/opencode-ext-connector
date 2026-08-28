import type { IntegrationDraft } from "./beta-api"
import type { ProviderEntry } from "./provider-entry"

export function registerProviderIntegrations(
  entries: readonly ProviderEntry[],
  draft: IntegrationDraft,
): void {
  for (const entry of entries) {
    draft.method.update({
      integrationID: entry.integrationId,
      method: entry.integrationMethod,
    })
  }
}
