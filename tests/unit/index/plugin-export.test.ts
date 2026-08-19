import { describe, expect, it } from "bun:test"
import { plugin } from "../../../src/index"
import { PLUGIN_ID } from "../../../src/opencode/plugin"

describe("plugin export", () => {
  it("exposes the connector id and setup", () => {
    // Given / When / Then
    expect(plugin.id).toBe(PLUGIN_ID)
    expect(typeof plugin.setup).toBe("function")
  })
})
