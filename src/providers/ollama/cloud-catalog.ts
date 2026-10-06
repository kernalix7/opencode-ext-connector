import { z } from "zod"

import type { AdapterModel } from "../../core/models.js"
import {
  HostedCloudIdSchema,
  type OllamaCloudReference,
  resolveCloudReference,
} from "./cloud-reference.js"
import { OllamaCatalogError } from "./errors.js"
import { type OllamaFetch, requestOllamaCatalog } from "./http.js"

const ModelSchema = z
  .object({
    name: HostedCloudIdSchema.optional(),
    model: HostedCloudIdSchema.optional(),
  })
  .refine(
    ({ name, model }) =>
      (name !== undefined || model !== undefined) &&
      (name === undefined || model === undefined || name === model),
  )
  .transform(({ name, model }) => HostedCloudIdSchema.parse(model ?? name))
const CatalogSchema = z.object({ models: z.array(ModelSchema).min(1).max(1024) })

export async function discoverOllamaCloudModels(
  fetch: OllamaFetch,
  signal: AbortSignal,
  concurrency: number = 4,
): Promise<readonly AdapterModel[]> {
  const references = await discoverOllamaCloudReferences(fetch, signal, concurrency)
  return references.map(({ model }) => model)
}

export async function discoverOllamaCloudReferences(
  fetch: OllamaFetch,
  signal: AbortSignal,
  concurrency: number = 4,
): Promise<readonly OllamaCloudReference[]> {
  const workerCount = z.number().int().min(1).max(8).parse(concurrency)
  const text = await requestOllamaCatalog({
    url: "https://ollama.com/api/tags",
    accept: "application/json",
    operation: "cloud-search",
    fetch,
    signal,
  })
  let ids: readonly z.infer<typeof HostedCloudIdSchema>[]
  try {
    const value: unknown = JSON.parse(text)
    ids = [...new Set(CatalogSchema.parse(value).models)]
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new OllamaCatalogError("cloud-search", "invalid-data")
    }
    throw error
  }
  const controller = new AbortController()
  const workerSignal = AbortSignal.any([signal, controller.signal])
  const results: OllamaCloudReference[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const index = next++
      const id = ids[index]
      if (id === undefined) return
      results[index] = { model: await resolveCloudReference(id, fetch, workerSignal), hostedId: id }
    }
  }
  const workers = Array.from({ length: Math.min(workerCount, ids.length) }, worker)
  try {
    await Promise.all(workers)
  } catch (error) {
    controller.abort(error)
    await Promise.allSettled(workers)
    throw error
  }
  return results
}
