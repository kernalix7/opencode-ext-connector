import { NoSuchModelError, type ProviderV3 } from "@ai-sdk/provider"

// CLI 2.0.20 resolves this factory before external SDK hooks run. It performs no I/O:
// only scoped V2 language hooks supply models; without them every fallback fails closed.
export function createConnectorProvider(): ProviderV3 {
  return {
    specificationVersion: "v3",
    languageModel: (modelId) => {
      throw new NoSuchModelError({ modelId, modelType: "languageModel" })
    },
    embeddingModel: (modelId) => {
      throw new NoSuchModelError({ modelId, modelType: "embeddingModel" })
    },
    imageModel: (modelId) => {
      throw new NoSuchModelError({ modelId, modelType: "imageModel" })
    },
  }
}
