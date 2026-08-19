import { describe, expect, it } from "bun:test"

import { parseModelId } from "../../../../src/core/ids"
import { listCursorModels, parseCursorModelOutput } from "../../../../src/providers/cursor/models"

describe("parseCursorModelOutput", () => {
  it("parses id - name lines from cursor-agent models", () => {
    // Given
    const stdout = [
      "Available models",
      "",
      "auto - Auto (current)",
      "composer-2.5 - Composer 2.5",
      "claude-sonnet-4-6 - Claude Sonnet 4.6",
    ].join("\n")
    // When
    const models = parseCursorModelOutput(stdout)
    // Then
    expect(models.map((model) => model.id)).toEqual([
      parseModelId("auto"),
      parseModelId("composer-2.5"),
      parseModelId("claude-sonnet-4-6"),
    ])
  })
})

describe("listCursorModels", () => {
  it("falls back to --list-models when models exits non-zero", async () => {
    // Given
    const calls: string[][] = []
    const run = async (_agent: string, args: readonly string[]) => {
      calls.push([...args])
      if (args[0] === "models") {
        return { code: 1, stdout: "" }
      }
      return { code: 0, stdout: "auto - Auto\ncomposer-2.5 - Composer 2.5\n" }
    }
    // When
    const models = await listCursorModels("cursor-agent", new AbortController().signal, run)
    // Then
    expect(calls).toEqual([["models"], ["--list-models"]])
    expect(models.map((model) => model.id)).toEqual([
      parseModelId("auto"),
      parseModelId("composer-2.5"),
    ])
  })
})
