import { parseModelIdList } from "../../catalog/parse-ids"
import type { HttpTransport } from "../../core/http"
import type { AdapterModel } from "../../core/models"
import { createClaudeCompatibilityHeaders } from "./compat-request"

export type ClaudeModelListOptions = {
  readonly transport: HttpTransport
  readonly token: string
  readonly version: string
  readonly signal: AbortSignal
}

export async function listClaudeModels(
  options: ClaudeModelListOptions,
): Promise<readonly AdapterModel[]> {
  const headers = createClaudeCompatibilityHeaders({
    accessToken: options.token,
    modelId: "unknown",
    version: options.version,
  })
  const response = await options.transport.request(
    {
      method: "GET",
      url: "https://api.anthropic.com/v1/models",
      headers: Object.fromEntries(headers.entries()),
      body: null,
    },
    options.signal,
  )
  if (response.status >= 400) {
    return []
  }
  try {
    return parseModelIdList(JSON.parse(new TextDecoder().decode(response.body)))
  } catch {
    return []
  }
}
