import { z } from "zod"

import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import { parseProviderId } from "../../core/ids.js"
import { type AdapterModel, parseAdapterModel } from "../../core/models.js"

const ModelsPageSchema = z
  .object({
    data: z.array(z.object({ id: z.string() }).passthrough().readonly()).readonly(),
    has_more: z.boolean(),
    last_id: z.string().nullable(),
  })
  .passthrough()
  .readonly()

export type ClaudeApiModelListOptions = {
  readonly transport: HttpTransport
  readonly apiKey: string
  readonly signal: AbortSignal
}

export async function listClaudeModels(
  options: ClaudeApiModelListOptions,
): Promise<readonly AdapterModel[]> {
  const models: AdapterModel[] = []
  const visited = new Set<string>()
  let afterId: string | null = null
  for (;;) {
    if (options.signal.aborted) throw new OperationCancelledError("claude-models")
    const url = new URL("https://api.anthropic.com/v1/models")
    if (afterId !== null) url.searchParams.set("after_id", afterId)
    const response = await options.transport.request(
      {
        method: "GET",
        url: url.toString(),
        headers: { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01" },
        body: null,
      },
      options.signal,
    )
    if (options.signal.aborted) throw new OperationCancelledError("claude-models")
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError({
        operation: "claude-models",
        providerId: parseProviderId("claude"),
        retryable: response.status >= 500,
        cause: null,
      })
    }
    const page = ModelsPageSchema.parse(JSON.parse(new TextDecoder().decode(response.body)))
    for (const item of page.data) models.push(parseAdapterModel({ id: item.id }))
    if (!page.has_more) return models
    if (page.last_id === null || !page.last_id || visited.has(page.last_id)) {
      throw new AdapterError({
        operation: "claude-models-pagination",
        providerId: parseProviderId("claude"),
        retryable: false,
        cause: null,
      })
    }
    visited.add(page.last_id)
    afterId = page.last_id
  }
}
