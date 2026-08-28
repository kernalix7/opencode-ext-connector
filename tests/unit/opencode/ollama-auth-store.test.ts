import { describe, expect, it } from "bun:test"

import { createOpenCodeAuthStore } from "../../../src/opencode/auth-store"

function storeFor(record: unknown) {
  return createOpenCodeAuthStore({
    env: { HOME: "/isolated" },
    platform: "linux",
    readFile: async () => JSON.stringify({ ollama: record }),
  })
}

describe("Ollama OpenCode auth marker", () => {
  it("accepts only the exact Ollama CLI session marker", async () => {
    // Given
    const records = [
      { type: "api", key: "cli-session:ollama" },
      { type: "api", key: "arbitrary-api-key" },
      { type: "api", key: "cli-session:cursor" },
      { type: "oauth", access: "a", refresh: "r", expires: 1 },
    ]

    // When
    const matches = await Promise.all(records.map((record) => storeFor(record).matchAuth("ollama")))

    // Then
    expect(matches).toEqual([{ kind: "marker" }, null, null, null])
  })
})
