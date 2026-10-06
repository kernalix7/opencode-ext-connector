import type { LanguageModelV3 } from "@ai-sdk/provider"
import { z } from "zod"

import { createFetchHttpTransport } from "../http/fetch-transport.js"
import { createOpenCodeAuthStore } from "./auth-store.js"
import { createConnectorLanguage } from "./language-factory.js"
import { getProductionOllamaBundle } from "./ollama-production.js"
import { readProviderApiKey } from "./providers.js"
import { resolveV1ModelView, unavailableV1Model } from "./v1-binding.js"

const ApiKeySchema = z
  .string()
  .min(1)
  .refine((key) => !key.startsWith("cli-session:"))

const env = process.env
const transport = createFetchHttpTransport()
const authStore = createOpenCodeAuthStore({ env })
const deps = {
  authStore,
  env,
  transport,
  allowEnvironmentKeys: true,
  clock: {
    nowMs: () => Date.now(),
    schedule: (delayMs: number, callback: () => void) => {
      const handle = setTimeout(callback, delayMs)
      const cancel = (): void => clearTimeout(handle)
      return { cancel, [Symbol.dispose]: cancel }
    },
  },
}

export function languageForV1Provider(
  providerID: string,
  modelId: string,
  options: Readonly<Record<string, unknown>>,
): LanguageModelV3 {
  if (Object.hasOwn(options, "connectorV1")) {
    const view = resolveV1ModelView(options["connectorV1"], providerID, modelId)
    const bound = createConnectorLanguage({
      transport: view.transport,
      readClaudeApiKey: view.readApiKey,
      readCommandCodeApiKey: view.readApiKey,
    })(providerID, modelId)
    if (bound === null) throw unavailableV1Model(modelId)
    return {
      specificationVersion: bound.specificationVersion,
      provider: bound.provider,
      modelId: bound.modelId,
      supportedUrls: bound.supportedUrls,
      doGenerate: (call) =>
        bound.doGenerate({
          ...call,
          abortSignal:
            call.abortSignal === undefined
              ? view.signal
              : AbortSignal.any([call.abortSignal, view.signal]),
        }),
      doStream: (call) =>
        bound.doStream({
          ...call,
          abortSignal:
            call.abortSignal === undefined
              ? view.signal
              : AbortSignal.any([call.abortSignal, view.signal]),
        }),
    }
  }
  const explicit = Object.hasOwn(options, "apiKey")
    ? ApiKeySchema.parse(options["apiKey"])
    : undefined
  const ollamaRuntime =
    providerID === "ollama"
      ? getProductionOllamaBundle(options["ollamaBaseURL"]).runtime
      : undefined
  const createLanguage = createConnectorLanguage({
    transport,
    readClaudeApiKey: (signal) =>
      explicit === undefined
        ? readProviderApiKey(deps, "claude", signal)
        : Promise.resolve(explicit),
    readCommandCodeApiKey: (signal) =>
      explicit === undefined
        ? readProviderApiKey(deps, "command-code", signal)
        : Promise.resolve(explicit),
    ...(ollamaRuntime === undefined ? {} : { ollamaRuntime }),
  })
  const model = createLanguage(providerID, modelId)
  if (model === null) throw unavailableV1Model(modelId)
  return model
}

export const disposeV1LanguageRuntime = async (): Promise<void> => undefined
