import { describe, expect, it } from "bun:test"

import { parseModelId } from "../../../../src/core/ids"
import { listCommandCodeModels } from "../../../../src/providers/command-code/models"
import { FakeHttpTransport } from "../../../support/http"

describe("listCommandCodeModels", () => {
  it("reads ids from /provider/v1/models", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({ data: [{ id: "deepseek/deepseek-v4-flash" }] }),
      ),
    })
    // When
    const models = await listCommandCodeModels(transport, "cc-token", new AbortController().signal)
    // Then
    expect(models).toEqual([{ id: parseModelId("deepseek/deepseek-v4-flash") }])
    expect(transport.requests.at(0)?.url).toBe("https://api.commandcode.ai/provider/v1/models")
  })
})
