import { parseModelIdList } from "../../catalog/parse-ids.js"
import type { HttpTransport } from "../../core/http.js"
import type { AdapterModel } from "../../core/models.js"

export async function listCommandCodeModels(
  transport: HttpTransport,
  token: string,
  signal: AbortSignal,
): Promise<readonly AdapterModel[]> {
  const response = await transport.request(
    {
      method: "GET",
      url: "https://api.commandcode.ai/provider/v1/models",
      headers: { authorization: `Bearer ${token}` },
      body: null,
    },
    signal,
  )
  signal.throwIfAborted()
  if (response.status < 200 || response.status >= 300) return []
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(response.body))
    return parseModelIdList(decoded)
  } catch (error) {
    if (error instanceof SyntaxError) return []
    throw error
  }
}
