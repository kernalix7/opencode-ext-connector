import { parseModelIdList } from "../../catalog/parse-ids.js"
import { OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import type { AdapterModel } from "../../core/models.js"
import { createClaudeCompatibilityHeaders } from "./compat-request.js"

export type ClaudeModelListOptions = {
  readonly transport: HttpTransport
  readonly token: string
  readonly version: string
  readonly signal: AbortSignal
}

export async function listClaudeModels(
  options: ClaudeModelListOptions,
): Promise<readonly AdapterModel[]> {
  if (options.signal.aborted) throw new OperationCancelledError("claude-models")
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
  if (options.signal.aborted) throw new OperationCancelledError("claude-models")
  if (response.status < 200 || response.status >= 300) return []
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(response.body))
  } catch (error) {
    if (error instanceof SyntaxError) return []
    throw error
  }
  return parseModelIdList(value)
}
