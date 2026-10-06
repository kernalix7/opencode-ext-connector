import { z } from "zod"

import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import type { HttpTransport } from "../../core/http.js"
import { ModelIdSchema, parseProviderId } from "../../core/ids.js"
import type { AdapterModel } from "../../core/models.js"

const modelSchema = z.object({
  id: z.string(),
  supported_endpoints: z.array(z.string()).readonly(),
})
const catalogSchema = z.object({ data: z.array(modelSchema).readonly() })

export type CommandCodeEndpoint = "chat" | "messages" | "responses"
export type CommandCodeCapability = {
  readonly model: AdapterModel
  readonly endpoint: CommandCodeEndpoint
}

// Only the documented provider routes (absolute or relative), never model-name inference.
function endpointFor(routes: readonly string[]): CommandCodeEndpoint | null {
  const supports = (route: string): boolean =>
    routes.includes(route) || routes.includes(`https://api.commandcode.ai${route}`)
  if (supports("/provider/v1/chat/completions")) return "chat"
  if (supports("/provider/v1/messages")) return "messages"
  if (supports("/provider/v1/responses")) return "responses"
  return null
}

export async function listCommandCodeCapabilities(options: {
  readonly transport: HttpTransport
  readonly apiKey: string
  readonly signal: AbortSignal
}): Promise<readonly CommandCodeCapability[]> {
  options.signal.throwIfAborted()
  const response = await options.transport.request(
    {
      method: "GET",
      url: "https://api.commandcode.ai/provider/v1/models",
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: null,
    },
    options.signal,
  )
  if (options.signal.aborted) throw new OperationCancelledError("command-code-catalog")
  if (response.status < 200 || response.status >= 300) {
    throw new AdapterError({
      operation: "command-code-catalog-http",
      providerId: parseProviderId("command-code"),
      retryable: response.status >= 500,
      cause: null,
    })
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(new TextDecoder().decode(response.body))
  } catch (error) {
    if (error instanceof SyntaxError) return []
    throw error
  }
  const catalog = catalogSchema.safeParse(decoded)
  if (!catalog.success) return []
  const capabilities: CommandCodeCapability[] = []
  for (const entry of catalog.data.data) {
    const endpoint = endpointFor(entry.supported_endpoints)
    const id = ModelIdSchema.safeParse(entry.id)
    if (endpoint !== null && id.success) {
      capabilities.push({ model: { id: id.data }, endpoint })
    }
  }
  return capabilities
}

export async function listCommandCodeModels(options: {
  readonly transport: HttpTransport
  readonly apiKey: string
  readonly signal: AbortSignal
}): Promise<readonly AdapterModel[]> {
  return (await listCommandCodeCapabilities(options)).map((capability) => capability.model)
}
