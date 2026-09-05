import { z } from "zod"

import type { AdapterModel } from "../../core/models.js"
import { parseAdapterModel } from "../../core/models.js"
import { OllamaCatalogError } from "./errors.js"
import { type OllamaFetch, requestOllamaCatalog } from "./http.js"

const LOCAL_TAGS_URL = "http://localhost:11434/api/tags"
const LocalModelSchema = z
  .object({ model: z.string().optional(), name: z.string().optional() })
  .superRefine((value, context) => {
    const model = value.model?.length === 0 ? undefined : value.model
    const name = value.name?.length === 0 ? undefined : value.name
    if (model === undefined && name === undefined) {
      context.addIssue({ code: "custom", message: "missing local model ID" })
    }
    if (model !== undefined && name !== undefined && model !== name) {
      context.addIssue({ code: "custom", message: "conflicting local model IDs" })
    }
  })
  .transform(({ model, name }) => (model?.length === 0 ? undefined : model) ?? name ?? "")
const LocalTagsSchema = z.object({ models: z.array(LocalModelSchema) }).readonly()

export async function listLocalOllamaModels(
  fetch: OllamaFetch,
  signal: AbortSignal,
): Promise<readonly AdapterModel[]> {
  const text = await requestOllamaCatalog({
    url: LOCAL_TAGS_URL,
    accept: "application/json",
    operation: "local-tags",
    fetch,
    signal,
  })
  try {
    const value: unknown = JSON.parse(text)
    return LocalTagsSchema.parse(value).models.map((id) => parseAdapterModel({ id }))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new OllamaCatalogError("local-tags", "invalid-data")
    }
    throw error
  }
}
