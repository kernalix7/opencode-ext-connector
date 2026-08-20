import { describe, expect, it } from "bun:test"

import pluginModule, {
  commandCodeAuthServer,
  connectorServer,
  cursorAuthServer,
} from "../../../src/index"

describe("plugin export", () => {
  it("exports only callable v1 hooks from the package root", () => {
    // Given / When / Then
    expect(pluginModule).toBe(connectorServer)
    expect(typeof connectorServer).toBe("function")
    expect(typeof cursorAuthServer).toBe("function")
    expect(typeof commandCodeAuthServer).toBe("function")
  })
})
