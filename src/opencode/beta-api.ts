export type {
  ConnectionInfo as PluginV2ConnectionInfo,
  OpenCodeEvent as PluginV2Event,
} from "@opencode/client"
export { ClientError as PluginV2ClientError } from "@opencode/client"
export {
  Credential as CredentialV2,
  Integration as IntegrationV2,
  Model as ModelV2,
  Plugin as PluginV2,
  Provider as ProviderV2,
} from "@opencode/plugin"
export { Host as HostV2 } from "@opencode/plugin/host"
export type {
  IntegrationEditor as PluginV2IntegrationEditor,
  IntegrationMethodRegistration as PluginV2IntegrationMethodRegistration,
} from "@opencode/plugin/promise/integration"
export type { Context as PluginV2Context } from "@opencode/plugin/promise/plugin"
export type { ProviderEditor as PluginV2ProviderEditor } from "@opencode/plugin/promise/provider"
export type { Registration as PluginV2Registration } from "@opencode/plugin/promise/registration"
export type {
  AISDKHooks,
  CatalogDraft,
  CatalogHooks,
  CatalogProviderRecord,
  IntegrationDraft,
  Plugin,
  PluginContext,
  Registration,
} from "@opencode-ai/plugin/v2/promise"
export { define } from "@opencode-ai/plugin/v2/promise"
export type { IntegrationEnvMethod, ModelV2Info, ProviderV2Info } from "@opencode-ai/sdk/v2/types"
