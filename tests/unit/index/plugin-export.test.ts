import { describe, expect, it } from "bun:test"
import { NoSuchModelError } from "@ai-sdk/provider"

import * as pluginModule from "../../../src/index"
import {
  claudeAuthServer,
  commandCodeAuthServer,
  connectorServer,
  cursorAuthServer,
  ollamaAuthServer,
  xaiAuthServer,
} from "../../../src/index"
import { createCommandCode } from "../../../src/sdk/command-code"
import { createCursor } from "../../../src/sdk/cursor"
import { createOllama } from "../../../src/sdk/ollama"

describe("plugin export", () => {
  it("exports exactly the six legacy OpenCode plugin functions", () => {
    // Given
    const expectedExports: readonly string[] = [
      "claudeAuthServer",
      "commandCodeAuthServer",
      "connectorServer",
      "cursorAuthServer",
      "ollamaAuthServer",
      "xaiAuthServer",
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
    expect(typeof xaiAuthServer).toBe("function")
  })

  it("rejects retired Cursor models before generation", () => {
    // Given
    const provider = createCursor()

    // When / Then
    expect(() => provider.languageModel("auto")).toThrow(NoSuchModelError)
  })

  it("rejects Cursor even when unrelated options are supplied", () => {
    // Given
    const provider = createCursor({ ollamaBaseURL: null })

    // When
    // Then
    expect(() => provider.languageModel("auto")).toThrow(NoSuchModelError)
  })

  it("ignores malformed Ollama options when constructing a Command Code model", () => {
    // Given
    const provider = createCommandCode({ apiKey: "synthetic-api-key", ollamaBaseURL: null })

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
