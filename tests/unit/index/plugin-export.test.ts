import { describe, expect, it } from "bun:test"

import * as pluginModule from "../../../src/index"
import {
  claudeAuthServer,
  commandCodeAuthServer,
  connectorServer,
  cursorAuthServer,
  ollamaAuthServer,
} from "../../../src/index"
import { createCursor } from "../../../src/sdk/cursor"
import { createOllama } from "../../../src/sdk/ollama"

describe("plugin export", () => {
  it("exports exactly the five legacy OpenCode plugin functions", () => {
    // Given
    const expectedExports: readonly string[] = [
      "claudeAuthServer",
      "commandCodeAuthServer",
      "connectorServer",
      "cursorAuthServer",
      "ollamaAuthServer",
    ]
    // When
    const exportedNames = Object.keys(pluginModule).sort()
    // Then
    expect(exportedNames).toEqual([...expectedExports].sort())
    expect(pluginModule).not.toHaveProperty("default")
    expect(typeof connectorServer).toBe("function")
    expect(typeof claudeAuthServer).toBe("function")
    expect(typeof cursorAuthServer).toBe("function")
    expect(typeof commandCodeAuthServer).toBe("function")
    expect(typeof ollamaAuthServer).toBe("function")
  })

  it("exposes Cursor as an AI SDK factory", () => {
    // Given / When
    const provider = createCursor()
    const model = provider.languageModel("auto")
    // Then
    expect(model.provider).toBe("cursor")
    expect(model.modelId).toBe("auto")
  })

  it("exposes Ollama as an AI SDK factory without forwarding provider options", () => {
    // Given / When
    const provider = createOllama({
      apiKey: "must-not-forward",
      baseURL: "https://must-not-forward.invalid",
      headers: { authorization: "must-not-forward" },
    })
    const model = provider.languageModel("local-model")

    // Then
    expect(model.provider).toBe("ollama")
    expect(model.modelId).toBe("local-model")
  })
})
