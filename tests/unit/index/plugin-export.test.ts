import { describe, expect, it } from "bun:test"

import * as pluginModule from "../../../src/index"
import {
  claudeAuthServer,
  commandCodeAuthServer,
  connectorServer,
  cursorAuthServer,
  ollamaAuthServer,
} from "../../../src/index"
import { createCommandCode } from "../../../src/sdk/command-code"
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

  it("ignores malformed Ollama options when constructing a Cursor model", () => {
    // Given
    const provider = createCursor({ ollamaBaseURL: null })

    // When
    const model = provider.languageModel("auto")

    // Then
    expect(model.provider).toBe("cursor")
    expect(model.modelId).toBe("auto")
  })

  it("ignores malformed Ollama options when constructing a Command Code model", () => {
    // Given
    const provider = createCommandCode({ ollamaBaseURL: null })

    // When
    const model = provider.languageModel("Qwen/Qwen3.8-Max")

    // Then
    expect(model.provider).toBe("command-code")
    expect(model.modelId).toBe("Qwen/Qwen3.8-Max")
  })

  it("rejects an invalid Ollama SDK base URL before model construction", () => {
    // Given / When
    const construct = (): void => {
      createOllama({ ollamaBaseURL: "https://ollama.com" }).languageModel("local-model")
    }

    // Then
    expect(construct).toThrow()
  })
})
