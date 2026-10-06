import type { LanguageModelV3 } from "@ai-sdk/provider"

import { AdapterError } from "../core/errors.js"
import type { HttpTransport } from "../core/http.js"
import { parseProviderId } from "../core/ids.js"
import type { OllamaRuntime } from "../providers/ollama/runtime.js"
import type { PluginV2Registration } from "./beta-api.js"
import { createConnectorLanguage } from "./language-factory.js"
import type { ProviderEntryDeps } from "./provider-entry.js"
import { readProviderApiKey } from "./providers.js"
import { CONNECTOR_AISDK_PACKAGE, CONNECTOR_MODULE } from "./v2-catalog.js"

export type V2LanguageBindings = {
  readonly deps: ProviderEntryDeps
  readonly ollamaRuntime?: OllamaRuntime
  readonly hasModel: (providerId: string, modelId: string) => boolean
  readonly isConnected: (providerId: string) => Promise<boolean>
  readonly generation: (providerId: string) => number
  readonly providerIds: readonly string[]
  readonly lifetime: AbortSignal
}

export type V2ModelHookInput = {
  readonly model: {
    readonly providerID: string
    readonly modelID: string
    readonly package?: string | undefined
  }
  readonly package?: string
  sdk?: unknown
  language?: LanguageModelV3
}

export type V2ModelHook = (
  name: "sdk" | "language",
  callback: (input: V2ModelHookInput) => void,
  options?: { readonly providerID?: string },
) => Promise<PluginV2Registration>

const sdkSentinel = Object.freeze({ connector: CONNECTOR_MODULE })

function scopedLanguage(
  bindings: V2LanguageBindings,
  providerId: string,
  modelId: string,
): LanguageModelV3 | null {
  const generation = bindings.generation(providerId)
  const requireConnection = async (operation: string): Promise<void> => {
    if (
      !bindings.lifetime.aborted &&
      bindings.hasModel(providerId, modelId) &&
      generation === bindings.generation(providerId) &&
      (await bindings.isConnected(providerId)) &&
      generation === bindings.generation(providerId) &&
      !bindings.lifetime.aborted &&
      bindings.hasModel(providerId, modelId)
    )
      return
    throw new AdapterError({
      operation,
      retryable: false,
      cause: null,
      providerId: parseProviderId(providerId),
    })
  }
  const transport: HttpTransport = {
    request: async (request, signal) => {
      await requireConnection("request")
      return bindings.deps.transport.request(request, AbortSignal.any([signal, bindings.lifetime]))
    },
    ...(bindings.deps.transport.stream === undefined
      ? {}
      : {
          stream: async (request, signal) => {
            await requireConnection("request")
            const stream = bindings.deps.transport.stream
            if (stream === undefined)
              throw new AdapterError({
                operation: "stream",
                retryable: false,
                cause: null,
                providerId: parseProviderId(providerId),
              })
            return stream.call(
              bindings.deps.transport,
              request,
              AbortSignal.any([signal, bindings.lifetime]),
            )
          },
        }),
  }
  const readApiKey = async (
    provider: "claude" | "command-code",
    signal: AbortSignal,
  ): Promise<string | null> => {
    await requireConnection("credentials")
    const key = await readProviderApiKey(bindings.deps, provider, signal)
    await requireConnection("credentials")
    return key
  }
  const model = createConnectorLanguage({
    transport,
    readClaudeApiKey: (signal) => readApiKey("claude", signal),
    readCommandCodeApiKey: (signal) => readApiKey("command-code", signal),
    ...(bindings.ollamaRuntime === undefined ? {} : { ollamaRuntime: bindings.ollamaRuntime }),
  })(providerId, modelId)
  if (model === null) return null
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: async (options) => {
      await requireConnection("generate")
      return model.doGenerate({
        ...options,
        abortSignal:
          options.abortSignal === undefined
            ? bindings.lifetime
            : AbortSignal.any([options.abortSignal, bindings.lifetime]),
      })
    },
    doStream: async (options) => {
      await requireConnection("stream")
      return model.doStream({
        ...options,
        abortSignal:
          options.abortSignal === undefined
            ? bindings.lifetime
            : AbortSignal.any([options.abortSignal, bindings.lifetime]),
      })
    },
  }
}

export async function registerV2LanguageHooks(
  hook: V2ModelHook,
  bindings: V2LanguageBindings,
): Promise<readonly PluginV2Registration[]> {
  const registrations: PluginV2Registration[] = []
  for (const providerID of bindings.providerIds) {
    registrations.push(
      await hook(
        "sdk",
        (evt) => {
          if (evt.model.package === CONNECTOR_AISDK_PACKAGE) evt.sdk = sdkSentinel
        },
        { providerID },
      ),
    )
  }
  for (const providerID of bindings.providerIds) {
    registrations.push(
      await hook(
        "language",
        (evt) => {
          if (evt.model.package !== CONNECTOR_AISDK_PACKAGE) return
          if (!bindings.hasModel(evt.model.providerID, evt.model.modelID)) return
          const language = scopedLanguage(bindings, evt.model.providerID, evt.model.modelID)
          if (language !== null) evt.language = language
        },
        { providerID },
      ),
    )
  }
  return registrations
}
