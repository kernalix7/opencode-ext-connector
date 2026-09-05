import { parseModelId } from "../core/ids.js"
import type { AdapterModel } from "../core/models.js"

function idFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value
  }
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = Reflect.get(value, "id")
    return typeof id === "string" && id.length > 0 ? id : null
  }
  return null
}

function collect(values: readonly unknown[]): AdapterModel[] {
  const models: AdapterModel[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const id = idFromUnknown(value)
    if (id === null || seen.has(id)) {
      continue
    }
    try {
      const parsed = parseModelId(id)
      seen.add(id)
      models.push({ id: parsed })
    } catch {}
  }
  return models
}

export function parseModelIdList(value: unknown): readonly AdapterModel[] {
  if (Array.isArray(value)) {
    return collect(value)
  }
  if (typeof value !== "object" || value === null) {
    return []
  }
  if ("data" in value) {
    const data = Reflect.get(value, "data")
    if (Array.isArray(data)) {
      return collect(data)
    }
  }
  if ("models" in value) {
    const models = Reflect.get(value, "models")
    if (Array.isArray(models)) {
      return collect(models)
    }
  }
  return []
}
