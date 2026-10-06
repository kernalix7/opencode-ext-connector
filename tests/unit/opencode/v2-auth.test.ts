import { describe, expect, it } from "bun:test"

import type { PluginV2ConnectionInfo } from "../../../src/opencode/beta-api"
import { createProviderRegistry } from "../../../src/opencode/providers"
import { createV2AuthStore, type V2ConnectionSource } from "../../../src/opencode/v2-auth"

const entries = createProviderRegistry()

function source(
  connection: PluginV2ConnectionInfo | undefined,
  key: string | undefined,
): V2ConnectionSource {
  return {
    active: async () => connection,
    resolve: async () => (key === undefined ? undefined : { type: "key", key }),
  }
}

describe("V2 selected connection", () => {
  it.each([
    ["claude", "ANTHROPIC_API_KEY"],
    ["command-code", "COMMAND_CODE_API_KEY"],
  ] as const)("resolves the selected %s env key through the host", async (provider, name) => {
    // Given
    const store = createV2AuthStore({
      entries,
      connection: source({ type: "env", name }, "selected-key"),
    })

    // When
    const match = await store.matchAuth(provider)

    // Then
    expect(match).toEqual({ kind: "api-key", key: "selected-key", connectionId: name })
  })

  it("refuses an unresolved selected env even when a process key exists", async () => {
    // Given
    const store = createV2AuthStore({
      entries,
      connection: source({ type: "env", name: "ANTHROPIC_API_KEY" }, undefined),
    })

    // When
    const match = await store.matchAuth("claude")

    // Then
    expect(match).toBeNull()
  })

  it("rejects native anthropic and wrong-method connections", async () => {
    // Given
    const native = createV2AuthStore({
      entries,
      connection: source({ type: "env", name: "ANTHROPIC_API_KEY" }, "native-key"),
    })
    const oauth = createV2AuthStore({
      entries,
      connection: source(
        { type: "credential", id: "one", label: "one", method: "oauth" },
        "other-key",
      ),
    })

    // When
    const nativeMatch = await native.matchAuth("ollama")
    const oauthMatch = await oauth.matchAuth("claude")

    // Then
    expect(nativeMatch).toBeNull()
    expect(oauthMatch).toBeNull()
  })

  it("refuses retired markers and exposes only the dedicated key connection identity", async () => {
    // Given
    const selected = {
      type: "credential",
      id: "account-two",
      label: "second",
      method: "key",
    } as const
    const store = createV2AuthStore({ entries, connection: source(selected, "account-two-key") })
    const marker = createV2AuthStore({
      entries,
      connection: source(selected, "cli-session:claude"),
    })

    // When
    const match = await store.matchAuth("claude")
    const retired = await marker.matchAuth("claude")

    // Then
    expect(match).toEqual({ kind: "api-key", key: "account-two-key", connectionId: "account-two" })
    expect(retired).toBeNull()
  })

  it("keeps Ollama's exact marker rule", async () => {
    // Given
    const selected = {
      type: "credential",
      id: "ollama-id",
      label: "ollama",
      method: "key",
    } as const
    const valid = createV2AuthStore({ entries, connection: source(selected, "cli-session:ollama") })
    const invalid = createV2AuthStore({ entries, connection: source(selected, "another-marker") })

    // When
    const match = await valid.matchAuth("ollama")
    const rejected = await invalid.matchAuth("ollama")

    // Then
    expect(match).toEqual({ kind: "marker", connectionId: "ollama-id" })
    expect(rejected).toBeNull()
  })
})
