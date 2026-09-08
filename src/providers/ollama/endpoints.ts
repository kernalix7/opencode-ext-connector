import { z } from "zod"

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"

export type OllamaEndpoints = {
  readonly baseURL: string
  readonly tagsURL: string
  readonly pullURL: string
  readonly chatURL: string
}

const DirectApiPaths = ["/api/tags", "/api/pull", "/api/chat"] as const

const OllamaBaseURLSchema = z
  .string()
  .refine(
    (value) =>
      value.length > 0 &&
      value === value.trim() &&
      /^https?:\/\//iu.test(value) &&
      !/[\t\r\n\\]/u.test(value) &&
      !/^https?:\/\/[^/?#]*@/iu.test(value) &&
      !/[?#]$/u.test(value) &&
      URL.canParse(value),
  )
  .transform((value) => new URL(value))
  .superRefine((url, context) => {
    const cloudHostname = url.hostname.toLowerCase().replace(/\.+$/u, "")
    const path = url.pathname.replace(/\/+$/u, "") || "/"
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname.length === 0 ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      cloudHostname === "ollama.com" ||
      cloudHostname.endsWith(".ollama.com") ||
      DirectApiPaths.some((apiPath) => path.endsWith(apiPath))
    ) {
      context.addIssue({ code: "custom", message: "invalid Ollama daemon base URL" })
    }
  })
  .transform((url) => `${url.origin}${url.pathname.replace(/\/+$/u, "")}`)

export function parseOllamaEndpoints(input: unknown): OllamaEndpoints {
  const baseURL = OllamaBaseURLSchema.parse(input === undefined ? DEFAULT_OLLAMA_BASE_URL : input)
  return Object.freeze({
    baseURL,
    tagsURL: `${baseURL}/api/tags`,
    pullURL: `${baseURL}/api/pull`,
    chatURL: `${baseURL}/api/chat`,
  })
}
