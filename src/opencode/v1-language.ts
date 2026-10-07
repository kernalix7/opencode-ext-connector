import type { LanguageModelV3 } from "@ai-sdk/provider"
import { z } from "zod"

import { createFetchHttpTransport } from "../http/fetch-transport.js"
import { createClaudeLanguageModel } from "../providers/claude/api-language-model.js"
import { createCommandCodeLanguageModel as createCommandCodeApiLanguageModel } from "../providers/command-code/api-language-model.js"
import { createConnectorLanguage } from "./language-factory.js"
import { getProductionOllamaBundle } from "./ollama-production.js"
import { resolveV1ModelView, unavailableV1Model } from "./v1-binding.js"

const ApiKeySchema = z
  .string()
  .min(1)
  .refine((key) => !key.startsWith("cli-session:"))

const transport = createFetchHttpTransport()

export function languageForV1Provider(
  providerID: string,
  modelId: string,
  options: Readonly<Record<string, unknown>>,
): LanguageModelV3 {
  if (Object.hasOwn(options, "connectorV1")) {
    const view = resolveV1ModelView(options["connectorV1"], providerID, modelId)
    if (view.route === "api") {
      if (providerID === "claude")
        return createClaudeLanguageModel({
          modelId,
          transport: view.transport,
          readApiKey: view.readApiKey,
        })
      if (providerID === "command-code")
        return createCommandCodeApiLanguageModel({
          modelId,
          transport: view.transport,
          readApiKey: view.readApiKey,
        })
      throw unavailableV1Model(modelId)
    }
    const bound = createConnectorLanguage({
      transport: view.transport,
      readAccessToken: view.readAccessToken,
      forceRefreshAccessToken: view.forceRefreshAccessToken,
      env: view.env,
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
  if (providerID === "claude" || providerID === "command-code") {
    if (explicit === undefined) throw unavailableV1Model(modelId)
    return providerID === "claude"
      ? createClaudeLanguageModel({ modelId, transport, readApiKey: async () => explicit })
      : createCommandCodeApiLanguageModel({ modelId, transport, readApiKey: async () => explicit })
  }
  const ollamaRuntime =
    providerID === "ollama"
      ? getProductionOllamaBundle(options["ollamaBaseURL"]).runtime
      : undefined
  const createLanguage = createConnectorLanguage({
    transport,
    env: process.env,
    readAccessToken: async () => null,
    forceRefreshAccessToken: async () => null,
    ...(ollamaRuntime === undefined ? {} : { ollamaRuntime }),
  })
  const model = createLanguage(providerID, modelId)
  if (model === null) throw unavailableV1Model(modelId)
  return model
}

export const disposeV1LanguageRuntime = async (): Promise<void> => undefined
