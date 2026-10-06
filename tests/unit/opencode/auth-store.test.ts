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

it("reads dedicated API records without consulting native anthropic or xai", async () => {
  // Given
  const store = createOpenCodeAuthStore({
    env: { XDG_DATA_HOME: "/isolated/data" },
    readFile: async () =>
      JSON.stringify({
        anthropic: { type: "api", key: "native-key" },
        xai: { type: "api", key: "native-xai-key" },
        claude: { type: "api", key: "dedicated-key" },
      }),
  })
  // When
  const match = await store.matchAuth("claude")
  // Then
  expect(match).toEqual({ kind: "api-key", key: "dedicated-key" })
})

it("rejects OAuth, CLI markers and malformed dedicated key records", async () => {
  // Given
  const records = [
    { type: "oauth", access: "old", refresh: "old", expires: 99 },
    { type: "api", key: "cli-session:claude" },
    { type: "api", key: "key", extra: "not-supported" },
  ]
  // When
  const matches = await Promise.all(
    records.map(async (claude) =>
      createOpenCodeAuthStore({
        env: { XDG_DATA_HOME: "/isolated/data" },
        readFile: async () => JSON.stringify({ claude }),
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
