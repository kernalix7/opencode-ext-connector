import { describe, expect, it } from "bun:test"

import { parseModelIdList } from "../../../src/catalog/parse-ids"
import { parseModelId } from "../../../src/core/ids"

describe("parseModelIdList", () => {
  it("reads OpenAI-style data[].id", () => {
    // Given
    const payload = { data: [{ id: "claude-sonnet-4-6" }, { id: "claude-opus-4-6" }] }
    // When
    const models = parseModelIdList(payload)
    // Then
    expect(models).toEqual([
      { id: parseModelId("claude-sonnet-4-6") },
      { id: parseModelId("claude-opus-4-6") },
    ])
  })

  it("reads a string array and models[].id", () => {
    // Given / When / Then
    expect(parseModelIdList(["auto", "composer-1.5"])).toEqual([
      { id: parseModelId("auto") },
      { id: parseModelId("composer-1.5") },
    ])
    expect(parseModelIdList({ models: [{ id: "deepseek/deepseek-v4-flash" }] })).toEqual([
      { id: parseModelId("deepseek/deepseek-v4-flash") },
    ])
  })

  it("skips invalid ids and returns empty for junk", () => {
    // Given / When / Then
    expect(parseModelIdList({ data: [{ id: "  bad  " }, { name: "x" }] })).toEqual([])
    expect(parseModelIdList(null)).toEqual([])
  })
})
