import { parseModelIdList } from "../../catalog/parse-ids"
import type { HttpTransport } from "../../core/http"
import type { AdapterModel } from "../../core/models"

export async function listClaudeModels(
  transport: HttpTransport,
  token: string,
  signal: AbortSignal,
): Promise<readonly AdapterModel[]> {
  const response = await transport.request(
    {
      method: "GET",
      url: "https://api.anthropic.com/v1/models",
      headers: {
        "anthropic-version": "2023-06-01",
        authorization: `Bearer ${token}`,
      },
      body: null,
    },
    signal,
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
