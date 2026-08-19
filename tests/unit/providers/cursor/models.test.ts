import { describe, expect, it } from "bun:test"

import { parseModelId } from "../../../../src/core/ids"
import { parseCursorModelOutput } from "../../../../src/providers/cursor/models"

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
