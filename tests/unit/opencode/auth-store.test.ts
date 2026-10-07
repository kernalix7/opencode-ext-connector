import { expect, it } from "bun:test"

import { createOpenCodeAuthStore, opencodeAuthJsonPaths } from "../../../src/opencode/auth-store"

it("uses only the configured OpenCode data location", () => {
  // Given / When
  const paths = opencodeAuthJsonPaths(
    { HOME: "/isolated/home", XDG_DATA_HOME: "/isolated/data" },
    "linux",
  )
  // Then
  expect(paths).toEqual(["/isolated/data/opencode/auth.json"])
})

it("reads only the existing anthropic session marker, not a dedicated Claude API key", async () => {
  // Given
  const store = createOpenCodeAuthStore({
    env: { XDG_DATA_HOME: "/isolated/data" },
    readFile: async () =>
      JSON.stringify({
        anthropic: { type: "api", key: "cli-session:anthropic" },
        xai: { type: "api", key: "native-xai-key" },
        claude: { type: "api", key: "dedicated-key" },
      }),
  })
  // When
  const match = await store.matchAuth("claude")
  // Then
  expect(match).toEqual({ kind: "marker" })
})

it("rejects wrong markers, API keys and incomplete subscription records", async () => {
  // Given
  const records = [
    { type: "oauth", refresh: "old", expires: 99 },
    { type: "api", key: "cli-session:claude" },
    { type: "api", key: "key", extra: "not-supported" },
  ]
  // When
  const matches = await Promise.all(
    records.map(async (claude) =>
      createOpenCodeAuthStore({
        env: { XDG_DATA_HOME: "/isolated/data" },
        readFile: async () => JSON.stringify({ anthropic: claude }),
      }).matchAuth("claude"),
    ),
  )
  // Then
  expect(matches).toEqual([null, null, null])
})

it("retains Ollama's exact daemon marker", async () => {
  // Given
  const store = createOpenCodeAuthStore({
    env: { XDG_DATA_HOME: "/isolated/data" },
    readFile: async () => JSON.stringify({ ollama: { type: "api", key: "cli-session:ollama" } }),
  })
  // When
  const match = await store.matchAuth("ollama")
  // Then
  expect(match).toEqual({ kind: "marker" })
})
