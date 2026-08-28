import { z } from "zod"

import type { AdapterModel } from "../../core/models"
import { parseAdapterModel } from "../../core/models"
import { OllamaCatalogError } from "./errors"
import { extractOfficialLibraryPaths } from "./html-links"
import { type OllamaFetch, requestOllamaCatalog } from "./http"

const CLOUD_SEARCH_URL = "https://ollama.com/search?c=cloud"
const FAMILY_CONCURRENCY = 4
const FamilySchema = z.string().regex(/^[A-Za-z0-9._-]+$/)
const TagSchema = z.string().min(1).max(256)

function searchFamilies(html: string): readonly string[] {
  const families: string[] = []
  const seen = new Set<string>()
  for (const path of extractOfficialLibraryPaths(html)) {
    const match = /^\/library\/([^/:]+)$/.exec(path)
    const parsed = FamilySchema.safeParse(match?.[1])
    if (parsed.success && !seen.has(parsed.data)) {
      seen.add(parsed.data)
      families.push(parsed.data)
    }
  }
  if (families.length === 0) throw new OllamaCatalogError("cloud-search", "invalid-data")
  return families
}

function familyModels(family: string, html: string): readonly AdapterModel[] {
  const models: AdapterModel[] = []
  const seen = new Set<string>()
  for (const path of extractOfficialLibraryPaths(html)) {
    const match = /^\/library\/([^/:]+):([^/]+)$/.exec(path)
    if (match?.[1] !== family) continue
    const tag = TagSchema.safeParse(match[2])
    if (!tag.success || (tag.data !== "cloud" && !tag.data.endsWith("-cloud"))) continue
    const id = `${family}:${tag.data}`
    if (!seen.has(id)) {
      seen.add(id)
      models.push(parseAdapterModel({ id }))
    }
  }
  if (models.length === 0) throw new OllamaCatalogError("cloud-family", "invalid-data")
  return models
}

async function discoverFamily(
  family: string,
  fetch: OllamaFetch,
  signal: AbortSignal,
): Promise<readonly AdapterModel[]> {
  const html = await requestOllamaCatalog({
    url: `https://ollama.com/library/${family}`,
    accept: "text/html",
    operation: "cloud-family",
    fetch,
    signal,
  })
  return familyModels(family, html)
}

export async function discoverOllamaCloudModels(
  fetch: OllamaFetch,
  signal: AbortSignal,
  concurrency: number = FAMILY_CONCURRENCY,
): Promise<readonly AdapterModel[]> {
  const workerCount = z.number().int().min(1).max(8).parse(concurrency)
  const searchHtml = await requestOllamaCatalog({
    url: CLOUD_SEARCH_URL,
    accept: "text/html",
    operation: "cloud-search",
    fetch,
    signal,
  })
  const families = searchFamilies(searchHtml)
  const results: Array<readonly AdapterModel[]> = Array.from({ length: families.length }, () => [])
  let nextFamily = 0
  const worker = async (): Promise<void> => {
    while (nextFamily < families.length) {
      const index = nextFamily
      nextFamily += 1
      const family = families[index]
      if (family === undefined) return
      results[index] = await discoverFamily(family, fetch, signal)
    }
  }
  await Promise.all(Array.from({ length: Math.min(workerCount, families.length) }, worker))
  const models = results.flat()
  if (models.length === 0) throw new OllamaCatalogError("cloud-search", "invalid-data")
  return models
}
